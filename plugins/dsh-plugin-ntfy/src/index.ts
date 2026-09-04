import { analyzeSessionNtfy } from "./analyze"
import { DEFAULT_CONFIG, SettingsSchema, type NtfyConfig } from "./config"
import { registerTriggers } from "./triggers"
import { registerNotifyTool } from "./tool"

export const name = "dsh-plugin-ntfy"
export const inject = ["tools"]

/** Lowercase kebab-case settings namespace; read/written via the `settings` service. */
const NS = "dsh-plugin-ntfy"

const NOTIFY_GUIDANCE = [
  "You can send push notifications to the user via the ntfy_notify tool.",
  "Use it when a long-running task finishes, an important milestone is reached, or something needs the user's attention.",
  "The message body should be one concise, specific sentence stating what happened and, when relevant, what to do next.",
  "The title prefix and tag are applied automatically per session; you only decide the message and, optionally, the priority.",
].join(" ")

/**
 * dsh-plugin-ntfy — send ntfy push notifications from DeepSeek Harness.
 *
 * - registers the model-facing `ntfy_notify` tool (manual notifications);
 * - hooks `jobs` and `sessions` to push turn/job completion & failure events;
 * - registers a `dsh-plugin-ntfy` settings namespace (settings.yaml + settings UI);
 * - adds a system-prompt section guiding concise notification content.
 */
export function apply(ctx: any) {
  let settings: NtfyConfig = DEFAULT_CONFIG
  const getConfig = () => settings

  ctx.inject(["settings"], (settingsCtx: any) => {
    settingsCtx.effect(() => {
      const scope = settingsCtx.settings.register(NS, SettingsSchema, { applies: "live" })
      settings = scope.get()
      const stopWatching = scope.watch((next: NtfyConfig) => {
        settings = next
      })
      return () => {
        stopWatching()
        settings = DEFAULT_CONFIG
      }
    }, "dsh-plugin-ntfy: settings namespace")
  })

  ctx.inject(["systemPrompt"], (promptCtx: any) => {
    promptCtx.effect(() =>
      promptCtx.systemPrompt.section({
        name: "ntfy:notify",
        order: 1000,
        text: NOTIFY_GUIDANCE,
      }),
    )
  })

  ctx.inject(["webServer"], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: "exact",
        path: "/plugins/dsh-plugin-ntfy/analyze",
        handler: async (req: any, res: any) => {
          res.setHeader("Content-Type", "application/json; charset=utf-8")
          try {
            const url = new URL(req.url ?? "/", "http://localhost")
            const sessionId = url.searchParams.get("sessionId")
            if (!sessionId) {
              res.writeHead(400)
              res.end(JSON.stringify({ titlePrefix: "", tag: "", error: "missing sessionId" }))
              return
            }
            const result = await analyzeSessionNtfy(ctx, sessionId)
            res.writeHead(200)
            res.end(JSON.stringify(result))
          } catch (error) {
            res.writeHead(500)
            res.end(JSON.stringify({ titlePrefix: "", tag: "", error: error instanceof Error ? error.message : String(error) }))
          }
        },
      }),
    "dsh-plugin-ntfy: analyze route")
  })

  registerNotifyTool(ctx, getConfig)
  registerTriggers(ctx, getConfig)
}
