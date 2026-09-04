import type { NtfyConfig, SessionOverride } from "./config"
import { summarizeSessionNtfy } from "./analyze"
import { publish } from "./publish"

interface OpenTurn {
  turn: unknown
  userInitiated: boolean
}

const COPY = {
  jobCompleted: { title: "DSH · 后台任务完成", tags: ["heavy_check_mark"] },
  jobFailed: { title: "DSH · 后台任务失败", tags: ["warning"], priority: "high" as const },
}

function sessionTitle(session: any): string | undefined {
  return session.title ?? session.header?.title ?? undefined
}

function resolveOverride(config: NtfyConfig, sessionId: string): SessionOverride | undefined {
  return config.sessionOverrides[sessionId]
}

function buildTitle(prefix: string | undefined, session: any): string {
  const base = sessionTitle(session)
  // No folded session title: the prefix alone carries the summary; never glue
  // a raw session id onto the notification title.
  if (prefix) return base ? `${prefix} - ${base}` : prefix
  return base ?? String(session.header?.id ?? "session")
}

/**
 * Push the turn-end notification. When `includeTurnSummary` is on, an
 * AI-generated markdown summary of the recent work becomes the message body
 * (under a status line); summary failures fall back to the status-only body.
 */
async function pushTurnNotification(
  ctx: any,
  getConfig: () => NtfyConfig,
  session: any,
  sessionId: string,
  completed: boolean,
  reason: string,
) {
  const config = getConfig()
  const override = resolveOverride(config, sessionId)
  const tag = override?.tag || (completed ? "heavy_check_mark" : "warning")
  const title = buildTitle(override?.titlePrefix || undefined, session)

  let message = completed ? "完成" : `失败（${reason}）`
  let markdown: boolean | undefined
  if (config.includeTurnSummary) {
    const result = await summarizeSessionNtfy(ctx, sessionId)
    if (result.summary !== "") {
      message = `${completed ? "✅ 完成" : `❌ 失败（${reason}）`}\n\n${result.summary}`
      markdown = true
    } else if (result.error !== undefined) {
      ctx.logger?.warn?.("dsh-plugin-ntfy: turn summary unavailable:", result.error)
    }
  }

  await publish(ctx, config, {
    message,
    title,
    tags: tag ? [tag] : undefined,
    priority: completed ? undefined : "high",
    markdown,
  })
}

function trackTurn(
  ctx: any,
  getConfig: () => NtfyConfig,
  openTurns: Map<string, OpenTurn>,
  session: any,
  event: any,
) {
  const config = getConfig()
  if (!config.enabled) return
  if (session.header.origin === "subagent") return

  const sessionId = String(session.header.id)

  if (event.type === "turn/start") {
    openTurns.set(sessionId, { turn: event.data.turn, userInitiated: false })
    return
  }

  if (event.type === "user/message") {
    const openTurn = openTurns.get(sessionId)
    if (openTurn !== undefined && event.data.source.kind === "user") openTurn.userInitiated = true
    return
  }

  if (event.type !== "turn/end") return
  const openTurn = openTurns.get(sessionId)
  if (openTurn === undefined || openTurn.turn !== event.data.turn) return
  openTurns.delete(sessionId)
  if (!openTurn.userInitiated) return

  const reason = String(event.data.reason.kind)
  const completed = reason === "completed"
  const failed = reason === "error" || reason === "max-tokens"
  if (!completed && !failed) return

  const override = resolveOverride(config, sessionId)
  const enabled =
    override !== undefined
      ? override.enabled
      : completed
        ? config.notifyOnTurnCompletion
        : config.notifyOnTurnFailure
  if (!enabled) return

  void pushTurnNotification(ctx, getConfig, session, sessionId, completed, reason)
}

/** Register optional auto-notification hooks on the `jobs` and `sessions` services. */
export function registerTriggers(ctx: any, getConfig: () => NtfyConfig) {
  ctx.inject(["jobs"], (jobsCtx: any) => {
    jobsCtx.effect(
      () =>
        jobsCtx.jobs.onJobDone((snapshot: any) => {
          const config = getConfig()
          if (!config.enabled) return
          if (snapshot.status === "completed" && config.notifyOnJobCompletion) {
            void publish(ctx, config, {
              message: "有一个后台任务已结束。",
              title: COPY.jobCompleted.title,
              tags: COPY.jobCompleted.tags,
            })
          } else if (snapshot.status === "failed" && config.notifyOnJobFailure) {
            void publish(ctx, config, {
              message: "有一个后台任务未能完成。",
              title: COPY.jobFailed.title,
              tags: COPY.jobFailed.tags,
              priority: COPY.jobFailed.priority,
            })
          }
        }),
      "dsh-plugin-ntfy: background job notification",
    )
  })

  ctx.inject(["sessions"], (sessionsCtx: any) => {
    sessionsCtx.effect(() => {
      const openTurns = new Map<string, OpenTurn>()
      const stopEvents = sessionsCtx.on("session/event", (session: any, event: any) => {
        trackTurn(ctx, getConfig, openTurns, session, event)
      })
      const stopDisposed = sessionsCtx.on("session/disposed", (session: any) => {
        openTurns.delete(String(session.header.id))
      })
      return () => {
        stopDisposed()
        stopEvents()
      }
    }, "dsh-plugin-ntfy: direct user turn notification")
  })
}
