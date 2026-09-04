import { useEffect, useState, type CSSProperties } from "react"
import { Modal } from "@deepseek-ai/dsh-client-ui-primitives"

/** Settings namespace owned by the Host half of this plugin. */
const NS = "dsh-plugin-ntfy"

export const inject = ["slots", "connection", "settingsScope"]

interface Override {
  enabled: boolean
  titlePrefix: string
  tag: string
}

function installStyles() {
  if (typeof document === "undefined") return
  if (document.querySelector("style[data-dsh-plugin-ntfy]")) return
  const style = document.createElement("style")
  style.setAttribute("data-dsh-plugin-ntfy", "1")
  style.textContent = ".dsh-ntfy-modal{min-width:460px;max-width:92vw}"
  document.head.appendChild(style)
}

/**
 * Client half of dsh-plugin-ntfy:
 * - a dedicated "ntfy" settings section (global config);
 * - a per-session "ntfy" button in the conversation header utilities, opening a modal.
 */
export function apply(ctx: any) {
  installStyles()
  const scope = ctx.settingsScope.bind({ namespace: NS })

  const snapshot = () => scope.getSnapshot()
  const subscribe = (listener: () => void) => scope.subscribe(listener)

  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "ntfy",
        order: 100,
        label: () => "ntfy",
        inject: () => ({
          hooks: { ntfy: { getSnapshot: snapshot, subscribe } },
          setField: (field: string, value: unknown) => scope.set(field, value),
        }),
      },
      NtfySection,
    ),
  )

  ctx.slots.inject("conversation.session.header.utilities", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.utilities",
        id: "ntfy",
        order: 100,
        inject: () => ({
          hooks: { ntfy: { getSnapshot: snapshot, subscribe } },
          setOverride: (sessionId: string, override: Override | null) => {
            const snap = scope.getSnapshot()
            const current = (snap.value?.sessionOverrides ?? {}) as Record<string, Override>
            const next = { ...current }
            if (override === null) delete next[sessionId]
            else next[sessionId] = override
            void scope.set("sessionOverrides", next)
          },
        }),
      },
      NtfyHeaderButton,
    ),
  )
}

const inputStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  padding: "7px 10px",
  fontSize: 14,
  borderRadius: 8,
  border: "1px solid var(--dsw-alias-border-l2, #ccc)",
  background: "var(--dsw-alias-bg-layer-2, #fff)",
  color: "var(--dsw-alias-label-primary, #111)",
}

const primaryBtn: CSSProperties = {
  padding: "6px 14px",
  fontSize: 13,
  borderRadius: 8,
  border: "1px solid transparent",
  background: "var(--dsw-alias-state-business-primary, #1a6ff5)",
  color: "#fff",
  cursor: "pointer",
}

const ghostBtn: CSSProperties = {
  ...primaryBtn,
  background: "transparent",
  border: "1px solid var(--dsw-alias-border-l2, #ddd)",
  color: "var(--dsw-alias-label-primary, #333)",
}

const dangerGhostBtn: CSSProperties = {
  ...ghostBtn,
  color: "#c62828",
}

function TextField(props: {
  label: string
  hint?: string
  value: unknown
  onCommit: (text: string) => void
}) {
  const { label, hint, value, onCommit } = props
  const [text, setText] = useState(value === undefined || value === null ? "" : String(value))
  useEffect(() => {
    setText(value === undefined || value === null ? "" : String(value))
  }, [value])

  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 13, color: "var(--dsw-alias-label-secondary, #666)" }}>{label}</span>
      <input
        type="text"
        value={text}
        spellCheck={false}
        style={inputStyle}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onCommit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur()
        }}
      />
      {hint !== undefined ? (
        <span style={{ fontSize: 12, color: "var(--dsw-alias-label-tertiary, #999)" }}>{hint}</span>
      ) : null}
    </label>
  )
}

function ToggleField(props: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const { label, checked, onChange } = props
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, cursor: "pointer" }}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

function NtfySection(props: any) {
  const snap = props.useNtfy((s: any) => s)

  if (snap.status === "unavailable") {
    return (
      <div style={{ padding: 12, fontSize: 13, color: "#888" }}>
        ntfy settings are unavailable on this connection.
      </div>
    )
  }

  if (snap.status !== "ready" || snap.value === undefined) {
    return <div style={{ padding: 12, fontSize: 13, color: "#888" }}>Loading ntfy settings…</div>
  }

  const v = snap.value
  const set = (field: string) => (value: unknown) => props.setField(field, value)

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 620 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>ntfy 通知</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--dsw-alias-label-tertiary, #999)" }}>
          把回合 / 后台任务的完成与失败推送到你的 ntfy 订阅端。
        </p>
      </div>

      <TextField
        label="Server"
        value={v.server}
        onCommit={(t) => set("server")(t.trim() || "https://ntfy.sh")}
      />
      <TextField
        label="Topic"
        hint="本质是密码，用随机名（[-_A-Za-z0-9]，最长 64）。"
        value={v.topic}
        onCommit={(t) => set("topic")(t.trim())}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>认证（自建实例启用了 access control 时填写）</span>
        <TextField
          label="Username"
          value={v.username}
          onCommit={(t) => set("username")(t.trim())}
        />
        <TextField
          label="Password（密码）"
          hint="直接填密码；或填环境变量名（如 NTFY_PASSWORD）从 credentials/环境读取。"
          value={v.passwordEnv}
          onCommit={(t) => set("passwordEnv")(t.trim())}
        />
        <TextField
          label="Access token（可直接填 token；大写环境变量名则从 credentials 读取）"
          hint="用 token 认证时填；优先于用户名密码。"
          value={v.accessTokenEnv}
          onCommit={(t) => set("accessTokenEnv")(t.trim())}
        />
      </div>

      <TextField
        label="Timeout (ms)"
        value={v.timeoutMs}
        onCommit={(t) => {
          const n = Number(t)
          set("timeoutMs")(Number.isFinite(n) && n > 0 ? Math.floor(n) : 10000)
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>自动通知（全局默认）</span>
        <ToggleField label="回合完成时通知" checked={v.notifyOnTurnCompletion} onChange={set("notifyOnTurnCompletion")} />
        <ToggleField label="回合失败时通知" checked={v.notifyOnTurnFailure} onChange={set("notifyOnTurnFailure")} />
        <ToggleField label="后台任务完成时通知" checked={v.notifyOnJobCompletion} onChange={set("notifyOnJobCompletion")} />
        <ToggleField label="后台任务失败时通知" checked={v.notifyOnJobFailure} onChange={set("notifyOnJobFailure")} />
        <ToggleField
          label="回合推送附带 AI 总结（Markdown 正文，超 200 字自动精简）"
          checked={v.includeTurnSummary}
          onChange={set("includeTurnSummary")}
        />
      </div>
    </div>
  )
}

function NtfyHeaderButton(props: any) {
  const { sessionId, useNtfy, setOverride } = props
  const [open, setOpen] = useState(false)
  const snap = useNtfy((s: any) => s)
  const override = snap.value?.sessionOverrides?.[sessionId] as Override | undefined

  const dotColor =
    override === undefined ? "#999" : override.enabled ? "#2e7d32" : "#c62828"

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="ntfy 推送设置"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          fontSize: 12,
          borderRadius: 8,
          border: "1px solid var(--dsw-alias-border-l2, #ddd)",
          background: "transparent",
          color: "var(--dsw-alias-label-primary, #333)",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: dotColor,
            flex: "none",
          }}
        />
        ntfy
      </button>

      <NtfySessionModal
        open={open}
        onClose={() => setOpen(false)}
        sessionId={sessionId}
        current={override}
        onSave={(value) => {
          setOverride(sessionId, value)
          setOpen(false)
        }}
        onReset={() => {
          setOverride(sessionId, null)
          setOpen(false)
        }}
      />
    </>
  )
}

function NtfySessionModal(props: {
  open: boolean
  onClose: () => void
  sessionId: string
  current?: Override
  onSave: (value: Override) => void
  onReset: () => void
}) {
  const { open, onClose, sessionId, current, onSave, onReset } = props
  const [enabled, setEnabled] = useState(current?.enabled ?? true)
  const [titlePrefix, setTitlePrefix] = useState(current?.titlePrefix ?? "")
  const [tag, setTag] = useState(current?.tag ?? "")
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState("")

  useEffect(() => {
    if (open) {
      setEnabled(current?.enabled ?? true)
      setTitlePrefix(current?.titlePrefix ?? "")
      setTag(current?.tag ?? "")
      setAnalyzeError("")
    }
  }, [open, current])

  async function analyze() {
    setAnalyzing(true)
    setAnalyzeError("")
    try {
      const res = await fetch(`/plugins/dsh-plugin-ntfy/analyze?sessionId=${encodeURIComponent(sessionId)}`)
      const data = (await res.json()) as { titlePrefix?: string; tag?: string; error?: string }
      if (data.error) {
        setAnalyzeError(data.error)
      } else {
        if (data.titlePrefix) setTitlePrefix(data.titlePrefix)
        if (data.tag) setTag(data.tag)
      }
    } catch (error) {
      setAnalyzeError(error instanceof Error ? error.message : String(error))
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ntfy 推送设置"
      closeLabel="关闭"
      className="dsh-ntfy-modal"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", width: "100%" }}>
          {current !== undefined ? (
            <button type="button" onClick={onReset} style={dangerGhostBtn}>
              恢复全局默认
            </button>
          ) : null}
          <button type="button" onClick={onClose} style={ghostBtn}>
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave({ enabled, titlePrefix: titlePrefix.trim(), tag: tag.trim() })}
            style={primaryBtn}
          >
            保存
          </button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div
          style={{
            fontSize: 12,
            color: "#999",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={sessionId}
        >
          会话：{sessionId}
        </div>
        <ToggleField label="开启本会话的 ntfy 推送" checked={enabled} onChange={setEnabled} />

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={analyze} disabled={analyzing} style={ghostBtn}>
            {analyzing ? "分析中…" : "AI 自动分析"}
          </button>
          <span style={{ fontSize: 12, color: "#999" }}>根据会话内容自动填写标题前缀和 Tag</span>
        </div>
        {analyzeError !== "" ? (
          <div style={{ fontSize: 12, color: "#c62828" }}>分析失败：{analyzeError}</div>
        ) : null}

        <TextField
          label="标题前缀"
          hint="发送时标题变为「前缀 - 会话标题」，如「需求A - 修复登录bug」。"
          value={titlePrefix}
          onCommit={(t) => setTitlePrefix(t)}
        />
        <TextField
          label="Tag"
          hint="固定标签/emoji 短码，如 heavy_check_mark、warning。"
          value={tag}
          onCommit={(t) => setTag(t)}
        />
      </div>
    </Modal>
  )
}
