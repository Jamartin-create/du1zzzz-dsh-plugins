import { defineTool } from "@deepseek-ai/dsh-tools"
import type { NtfyConfig, SessionOverride } from "./config"
import { publish, type NtfyPriority } from "./publish"

const PRIORITIES = ["min", "low", "default", "high", "urgent"]

function sessionIdOf(exec: any): string | undefined {
  const id = exec?.agent?.session?.header?.id
  return id === undefined ? undefined : String(id)
}

function overrideFor(getConfig: () => NtfyConfig, exec: any): SessionOverride | undefined {
  const sessionId = sessionIdOf(exec)
  if (sessionId === undefined) return undefined
  return getConfig().sessionOverrides[sessionId]
}

/** Apply the current session's title prefix and fixed tag over the agent-provided values. */
function composeTitle(args: any, override: SessionOverride | undefined): string | undefined {
  const prefix = override?.titlePrefix
  if (!prefix) return args.title || undefined
  return args.title ? `${prefix} - ${args.title}` : prefix
}

function composeTags(args: any, override: SessionOverride | undefined): string[] | undefined {
  const parts: string[] = []
  if (override?.tag) parts.push(override.tag)
  if (args.tags) {
    for (const tag of String(args.tags).split(",")) {
      const t = tag.trim()
      if (t && !parts.includes(t)) parts.push(t)
    }
  }
  return parts.length > 0 ? parts : undefined
}

/** Register the model-facing `ntfy_notify` tool for manual notifications. */
export function registerNotifyTool(ctx: any, getConfig: () => NtfyConfig) {
  const tools = ctx.get("tools")
  if (tools === undefined) return

  tools.register(
    defineTool({
      name: "ntfy_notify",
      description:
        "Send a push notification to the user's phone (or other ntfy subscriber) via ntfy. " +
        "Use it to alert the user when a long-running task finishes, an error needs attention, " +
        "or an important milestone is reached. The message should be a concise one-sentence summary. " +
        "The per-session title prefix and tag are applied automatically.",
      parameters: {
        message: {
          type: "string",
          required: true,
          description: "Notification body text: a concise one-sentence summary of what happened.",
        },
        title: {
          type: "string",
          description: "Optional title suffix; the session's title prefix is prepended automatically.",
        },
        priority: {
          type: "string",
          enum: PRIORITIES,
          description: "Notification priority: min, low, default, high, or urgent.",
        },
        tags: {
          type: "string",
          description:
            'Optional comma-separated tags/emoji shortcodes, e.g. "heavy_check_mark,warning".',
        },
        topic: {
          type: "string",
          description: "Optional ntfy topic override; defaults to the plugin's configured topic.",
        },
      },
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ok: { type: "boolean", required: true },
            status: { oneOf: [{ type: "integer" }, { type: "null" }] },
            error: { oneOf: [{ type: "string" }, { type: "null" }] },
          },
        },
        render: (_args: any, value: any) => [
          {
            type: "text",
            text: value.ok
              ? `Notification sent (HTTP ${value.status}).`
              : `Notification not sent: ${value.error ?? `HTTP ${value.status ?? "unknown"}`}`,
          },
        ],
      },
      async execute(args: any, exec: any) {
        exec.signal?.throwIfAborted?.()
        const override = overrideFor(getConfig, exec)
        const result = await publish(ctx, getConfig(), {
          message: args.message,
          title: composeTitle(args, override),
          priority: args.priority as NtfyPriority | undefined,
          tags: composeTags(args, override),
          topic: args.topic || undefined,
        })
        return {
          ok: result.ok,
          status: result.status ?? null,
          error: result.error ?? null,
        }
      },
      presentCall(args: any) {
        return {
          card: "generic",
          title: args.message,
          kind: "execute",
          rawInput: args.message,
        }
      },
    }),
  )
}
