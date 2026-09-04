import z from "@deepseek-ai/schemastery"

/** Per-session ntfy override: enable/disable push, a title prefix, and a fixed tag. */
export interface SessionOverride {
  enabled: boolean
  titlePrefix: string
  tag: string
}

/** Resolved plugin settings (all fields defaulted by the schema). */
export interface NtfyConfig {
  enabled: boolean
  server: string
  topic: string
  username: string
  passwordEnv: string
  accessTokenEnv: string
  timeoutMs: number
  notifyOnTurnCompletion: boolean
  notifyOnTurnFailure: boolean
  notifyOnJobCompletion: boolean
  notifyOnJobFailure: boolean
  /** Attach an AI-generated markdown summary to turn notifications. */
  includeTurnSummary: boolean
  sessionOverrides: Record<string, SessionOverride>
}

/** Settings-namespace schema; values resolve from schema defaults + settings.yaml user layer. */
export const SettingsSchema = z.object({
  enabled: z.boolean().default(true),
  server: z.string().default("https://ntfy.sh"),
  topic: z.string().default(""),
  username: z.string().default(""),
  passwordEnv: z.string().default(""),
  accessTokenEnv: z.string().default(""),
  timeoutMs: z.natural().default(10_000),
  notifyOnTurnCompletion: z.boolean().default(true),
  notifyOnTurnFailure: z.boolean().default(true),
  notifyOnJobCompletion: z.boolean().default(true),
  notifyOnJobFailure: z.boolean().default(true),
  includeTurnSummary: z.boolean().default(true),
  sessionOverrides: z.dict(
    z.object({
      enabled: z.boolean(),
      titlePrefix: z.string(),
      tag: z.string(),
    }),
  ).default({}),
})

export const DEFAULT_CONFIG: NtfyConfig = {
  enabled: true,
  server: "https://ntfy.sh",
  topic: "",
  username: "",
  passwordEnv: "",
  accessTokenEnv: "",
  timeoutMs: 10_000,
  notifyOnTurnCompletion: true,
  notifyOnTurnFailure: true,
  notifyOnJobCompletion: true,
  notifyOnJobFailure: true,
  includeTurnSummary: true,
  sessionOverrides: {},
}
