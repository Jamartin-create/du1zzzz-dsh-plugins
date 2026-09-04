import type { NtfyConfig } from "./config"

export type NtfyPriority = "min" | "low" | "default" | "high" | "urgent"

export interface PublishInput {
  message: string
  title?: string
  priority?: NtfyPriority
  tags?: string[]
  click?: string
  markdown?: boolean
  topic?: string
}

export interface PublishResult {
  ok: boolean
  status?: number
  error?: string
}

let warnedMissingTopic = false

/** RFC 2047 base64-encode a header value when it contains non-ASCII bytes. */
function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(value)) return value
  const encoded = Buffer.from(value, "utf8").toString("base64")
  return `=?UTF-8?B?${encoded}?=`
}

// A value is treated as an env-var NAME only when it looks like one (uppercase, e.g. NTFY_PASSWORD).
// ntfy tokens start with lowercase `tk_` and a literal password may contain any character, so
// anything else is treated as a literal secret.
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/

/** Resolve a secret field: an env-var name resolves through credentials/env; anything else is a literal secret. */
async function resolveSecret(ctx: any, value: string): Promise<string | undefined> {
  if (!value) return undefined
  if (!ENV_NAME_PATTERN.test(value)) return value
  const credentials = ctx.get("credentials")
  if (credentials !== undefined) {
    const hit = await credentials.resolve(value)
    if (hit !== undefined && hit.value) return hit.value
  }
  const ambient = process.env[value]
  if (ambient) return ambient
  return undefined
}

/** Publish one message to an ntfy topic. Never rejects; failures are reported in the result. */
export async function publish(ctx: any, config: NtfyConfig, input: PublishInput): Promise<PublishResult> {
  if (!config.enabled) return { ok: false, error: "ntfy notifications are disabled" }
  const topic = input.topic || config.topic
  if (!topic) {
    if (!warnedMissingTopic) {
      warnedMissingTopic = true
      ctx.logger?.warn?.(
        "dsh-plugin-ntfy: no topic configured; notifications are not sent. " +
          'Set `topic` in Settings → Plugins → ntfy, or in settings.yaml under `dsh-plugin-ntfy`.',
      )
    }
    return { ok: false, error: "no ntfy topic configured" }
  }

  const server = config.server.replace(/\/+$/, "")
  const url = `${server}/${topic}`

  const headers = new Headers()
  if (input.title) headers.set("Title", encodeHeaderValue(input.title))
  if (input.priority) headers.set("Priority", input.priority)
  if (input.tags && input.tags.length > 0) headers.set("Tags", encodeHeaderValue(input.tags.join(",")))
  if (input.click) headers.set("Click", input.click)
  if (input.markdown) headers.set("Markdown", "yes")

  try {
    // Auth: Bearer (access token) wins, then Basic (username + password), else anonymous.
    const token = await resolveSecret(ctx, config.accessTokenEnv)
    const password = await resolveSecret(ctx, config.passwordEnv)
    if (token) {
      headers.set("Authorization", `Bearer ${token}`)
    } else if (config.username) {
      const basic = Buffer.from(`${config.username}:${password ?? ""}`, "utf8").toString("base64")
      headers.set("Authorization", `Basic ${basic}`)
    }

    const res = await fetch(url, {
      method: "POST",
      body: input.message,
      headers,
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    if (res.ok) return { ok: true, status: res.status }
    let detail = ""
    try {
      const body = await res.text()
      if (body) detail = `: ${body.slice(0, 300)}`
    } catch {
      // ignore body-read failures
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}${detail}` }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
