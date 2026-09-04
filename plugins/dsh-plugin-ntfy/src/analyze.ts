import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm"

export interface NtfyAnalysis {
  titlePrefix: string
  tag: string
}

const SYSTEM = [
  "You summarize an AI coding-assistant session for a push notification.",
  "You are given the session title (when one exists) and excerpts from the recent conversation.",
  "Propose a titlePrefix: a concise phrase (6-25 characters, in the user's language) that concretely summarizes what this session is working on, e.g. 修复登录过期跳转, 重构 ntfy 标题分析.",
  "Base it on the conversation content, not on the literal session title; avoid generic words like 会话, 编码助手, assistant, session.",
  "Also propose a tag: one emoji shortcode, e.g. heavy_check_mark, warning, rocket, bug, construction.",
  "Output exactly one line containing only a JSON object with the two keys titlePrefix and tag (both strings).",
  "Do not wrap it in markdown fences, do not add any preamble, explanation, or trailing text.",
].join(" ")

const SUMMARY_SYSTEM = [
  "You summarize the latest work of an AI coding-assistant session as the body of a push notification.",
  "You are given the session title (when one exists) and excerpts from the recent conversation.",
  "Write a complete summary in markdown, in the user's language: what was done, key changes or findings, and the outcome.",
  "Use a few short bullet points. No title, no preamble, no closing remarks.",
].join(" ")

/** Push bodies longer than this are condensed by a second LLM pass. */
export const SUMMARY_MAX_CHARS = 200

const CONDENSE_SYSTEM = [
  `Condense the given markdown summary to at most ${SUMMARY_MAX_CHARS} characters (each Chinese character counts as one).`,
  "Keep the single most important outcome and the markdown list formatting.",
  "Output only the condensed summary, no preamble.",
].join(" ")

/** Caps for the conversation excerpts fed to the auxiliary model. */
interface ExcerptLimits {
  maxEvents: number
  maxChars: number
  maxTotal: number
}
const ANALYZE_EXCERPTS: ExcerptLimits = { maxEvents: 10, maxChars: 400, maxTotal: 3000 }
const SUMMARY_EXCERPTS: ExcerptLimits = { maxEvents: 16, maxChars: 600, maxTotal: 6000 }

/**
 * Collect the session's recent user/assistant conversation excerpts via the
 * `sessionQuery` service. Returns "" when the service or the session history
 * is unavailable — callers then fall back to the title alone.
 */
async function readConversationExcerpts(
  ctx: any,
  sessionId: string,
  limits: ExcerptLimits = ANALYZE_EXCERPTS,
): Promise<string> {
  const query = ctx.get("sessionQuery", false)
  if (query?.filterEvents === undefined) return ""
  try {
    const docs = (await query.filterEvents(sessionId, [
      { kind: "surface", values: ["current"] },
      { kind: "type", values: ["user/message", "assistant/message"] },
    ])) as Array<{ type: string; text: string }>
    const lines: string[] = []
    let total = 0
    for (const doc of docs.slice(-limits.maxEvents)) {
      const role = doc.type === "user/message" ? "user" : "assistant"
      const text = doc.text.replace(/\s+/g, " ").trim().slice(0, limits.maxChars)
      if (text === "") continue
      const line = `${role}: ${text}`
      if (total + line.length > limits.maxTotal) break
      lines.push(line)
      total += line.length
    }
    return lines.join("\n")
  } catch {
    return ""
  }
}

/** Read the session's folded title, undefined when none exists or the read fails. */
async function readSessionTitle(ctx: any, sessionId: string): Promise<string | undefined> {
  try {
    const title = await ctx.get("sessionQuery", false)?.readTitleSnapshot(sessionId, AbortSignal.timeout(5_000))
    return title?.title || undefined
  } catch {
    return undefined
  }
}

function extractJson(text: string): NtfyAnalysis | undefined {
  // 1. strip markdown code fences and surrounding whitespace
  const cleaned = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim()

  // 2. find the first balanced {...} block
  const candidates: string[] = []
  const start = cleaned.indexOf("{")
  if (start !== -1) {
    let depth = 0
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (ch === "{") depth++
      else if (ch === "}") {
        depth--
        if (depth === 0) {
          candidates.push(cleaned.slice(start, i + 1))
          break
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Record<string, unknown>
      const titlePrefix = typeof parsed.titlePrefix === "string" ? parsed.titlePrefix.trim() : ""
      const tag = typeof parsed.tag === "string" ? parsed.tag.trim() : ""
      if (titlePrefix || tag) return { titlePrefix, tag }
    } catch {
      // try the next candidate / fallback
    }
  }

  // 3. regex fallback over the raw text
  const tp = /"titlePrefix"\s*:\s*"([^"]*)"/.exec(text)?.[1]?.trim() ?? ""
  const tg = /"tag"\s*:\s*"([^"]*)"/.exec(text)?.[1]?.trim() ?? ""
  if (tp || tg) return { titlePrefix: tp, tag: tg }

  return undefined
}

interface ResolvedRoute {
  route: { provider: string; model: string }
  llm: any
}

/** Resolve the current default model route and the llm service; undefined when either is missing. */
function resolveRoute(ctx: any): ResolvedRoute | undefined {
  const route = ctx.get("agentDefaultModel", false)?.currentSelection?.()
  const llm = ctx.get("llm", false)
  if (!route?.provider || !route?.model || llm === undefined) return undefined
  return { route, llm }
}

interface LlmTextResult {
  text: string
  finishKind: string
  error?: string
}

/**
 * Run one small auxiliary LLM call and collect its text output. Adapter
 * failures arrive in-band as a terminal `finish` chunk (kind "error" |
 * "aborted"), not as throws — they are reported via `error`. Never rejects.
 */
async function callLlmForText(
  ctx: any,
  resolved: ResolvedRoute,
  sessionId: string,
  options: { system: string; prompt: string; maxTokens: number; purpose: string },
): Promise<LlmTextResult> {
  const messages = [
    createUserMessage({
      content: [{ type: "text", text: options.prompt }],
      source: { kind: "plugin", plugin: "dsh-plugin-ntfy" },
    }),
  ]
  try {
    const signal = AbortSignal.timeout(30_000)
    const assembler = new BlockAssembler()
    for await (const chunk of resolved.llm.stream({
      provider: resolved.route.provider,
      model: resolved.route.model,
      messages,
      system: options.system,
      maxTokens: options.maxTokens,
      reasoningEffort: "low",
      sessionId,
      purpose: options.purpose,
      signal,
    })) {
      signal.throwIfAborted()
      assembler.push(chunk)
    }

    const finish = assembler.finish as { kind: string; failure?: { message?: string; code?: string } }
    if (finish.kind === "error" || finish.kind === "aborted") {
      const message = finish.failure?.message || `LLM call ${finish.kind}`
      ctx.logger?.warn?.(`dsh-plugin-ntfy: ${options.purpose} LLM call ${finish.kind}:`, message)
      return { text: "", finishKind: finish.kind, error: message }
    }

    const blocks = assembler.blocks()
    const textBlocks = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
    const reasoningBlocks = blocks.filter((b: any) => b.type === "reasoning").map((b: any) => b.text).join(" ")
    const text = textBlocks.trim() !== "" ? textBlocks : reasoningBlocks
    return { text, finishKind: finish.kind }
  } catch (error) {
    return { text: "", finishKind: "error", error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Analyze a session and propose a notification title prefix + tag via a small
 * auxiliary LLM call on the current default model. Never rejects.
 */
export async function analyzeSessionNtfy(ctx: any, sessionId: string): Promise<NtfyAnalysis & { error?: string }> {
  const empty = { titlePrefix: "", tag: "" }

  const resolved = resolveRoute(ctx)
  if (resolved === undefined) return { ...empty, error: "no default model configured" }

  const label = await readSessionTitle(ctx, sessionId)
  const excerpts = await readConversationExcerpts(ctx, sessionId)
  const promptText = [
    `Session title: ${label ?? "(untitled)"}`,
    excerpts !== "" ? `\nRecent conversation (oldest to newest):\n${excerpts}` : "",
  ].join("")

  const result = await callLlmForText(ctx, resolved, sessionId, {
    system: SYSTEM,
    prompt: promptText,
    maxTokens: 1000,
    purpose: "ntfy-analyze",
  })
  if (result.error !== undefined) return { ...empty, error: result.error }

  const parsed = extractJson(result.text)
  if (parsed === undefined) {
    ctx.logger?.warn?.("dsh-plugin-ntfy: analyze output not parseable:", JSON.stringify(result.text))
    return {
      ...empty,
      error:
        result.finishKind === "max-tokens"
          ? "model output reached the token cap before producing JSON"
          : "model produced no valid JSON",
    }
  }
  return parsed
}

/** Count characters by code point, so a Chinese character counts as one. */
function charLength(text: string): number {
  return [...text].length
}

function truncateChars(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, max - 1).join("") + "…"
}

export interface NtfySummary {
  summary: string
  error?: string
}

/**
 * Summarize the session's recent work as a markdown push body via the current
 * default model. Bodies longer than SUMMARY_MAX_CHARS go through one
 * condensing pass (with a hard truncation safety net). Never rejects.
 */
export async function summarizeSessionNtfy(ctx: any, sessionId: string): Promise<NtfySummary> {
  const empty = { summary: "" }

  const resolved = resolveRoute(ctx)
  if (resolved === undefined) return { ...empty, error: "no default model configured" }

  const excerpts = await readConversationExcerpts(ctx, sessionId, SUMMARY_EXCERPTS)
  if (excerpts === "") return { ...empty, error: "no conversation content available" }

  const label = await readSessionTitle(ctx, sessionId)
  const promptText = [
    `Session title: ${label ?? "(untitled)"}`,
    `\nRecent conversation (oldest to newest):\n${excerpts}`,
  ].join("")

  const first = await callLlmForText(ctx, resolved, sessionId, {
    system: SUMMARY_SYSTEM,
    prompt: promptText,
    maxTokens: 1500,
    purpose: "ntfy-summary",
  })
  if (first.error !== undefined) return { ...empty, error: first.error }
  let summary = first.text.trim()
  if (summary === "") return { ...empty, error: "model produced no summary" }

  // Short enough: push the complete summary as-is.
  if (charLength(summary) <= SUMMARY_MAX_CHARS) return { summary }

  // Otherwise condense once; fall back to hard truncation if the model miscounts.
  const condensed = await callLlmForText(ctx, resolved, sessionId, {
    system: CONDENSE_SYSTEM,
    prompt: summary,
    maxTokens: 800,
    purpose: "ntfy-summary-condense",
  })
  if (condensed.text.trim() !== "") summary = condensed.text.trim()
  return { summary: truncateChars(summary, SUMMARY_MAX_CHARS) }
}
