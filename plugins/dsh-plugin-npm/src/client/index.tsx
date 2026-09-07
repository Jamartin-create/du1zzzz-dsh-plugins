import { useEffect, useState, useCallback } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'

// react-dom 是 client bundle 的外部依赖（neverBundle），由 __ModuleLoader__ 的
// factory(require) 注入；工作区没有 @types/react-dom，这里给出最小类型。
// tsconfig.client 未注入 node 类型，声明工厂参数 require 的最小签名。
declare var require: (id: string) => any

interface ReactDomRoot {
  render(children: any): void
  unmount(): void
}
function createOverlayRoot(container: Element): ReactDomRoot {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createRoot } = require('react-dom/client')
  return createRoot(container)
}

/** Settings namespace owned by the Host half of this plugin. */
const NS = 'dsh-plugin-npm'

export const inject = ['slots', 'connection', 'settingsScope', 'uiWorkspace']

// ========== Types ==========

interface RemotePackage {
  name: string
  version: string
  description: string
  license: string
  homepage?: string
  repository?: string
  registryId: string
  downloadsWeekly: number
  downloadsMonthly: number
  updatedAt: string
  syncedAt: string
}

interface LocalPackage {
  id: string
  name: string
  path: string
  description?: string
  version?: string
  registryId?: string
  status: 'valid' | 'invalid' | 'pending'
  validationErrors: string[]
  lastValidatedAt?: string
  createdAt: string
  updatedAt: string
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  metadata?: {
    name: string
    version: string
    description?: string
  }
}

interface SyncResult {
  success: boolean
  registryId: string
  packagesCount: number
  error?: string
}

interface PublishResult {
  success: boolean
  packageName?: string
  version?: string
  registryId?: string
  error?: string
}

// ========== Styles ==========

function installStyles() {
  if (typeof document === 'undefined') return
  if (document.querySelector('style[data-dsh-plugin-npm]')) return
  const style = document.createElement('style')
  style.setAttribute('data-dsh-plugin-npm', '1')
  style.textContent = `
    /* ---- sidebar entry (DOM-injected row) ---- */
    .dsh-npm-sidebar-entry {
      appearance: none;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      margin: 2px 0;
      padding: 6px 10px;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: var(--dsw-alias-label-secondary, #666);
      font: inherit;
      font-size: 13px;
      line-height: 20px;
      text-align: left;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .dsh-npm-sidebar-entry:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
      color: var(--dsw-alias-label-primary, #333);
    }
    .dsh-npm-sidebar-entry[data-active="true"] {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
      color: var(--dsw-alias-label-primary, #333);
      font-weight: 500;
    }
    .dsh-npm-sidebar-entry-icon {
      display: inline-flex;
      flex: none;
      width: 18px;
      height: 18px;
    }
    .dsh-npm-sidebar-entry-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ---- overlay layout ---- */
    .dsh-npm-overlay {
      min-width: 800px;
      max-width: 95vw;
      min-height: 600px;
      max-height: 90vh;
    }
    .dsh-npm-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }
    .dsh-npm-count {
      font-size: 13px;
      color: var(--dsw-alias-label-tertiary, #999);
    }

    /* ---- tabs ---- */
    .dsh-npm-tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--dsw-alias-border-l2, #ddd);
      margin-bottom: 20px;
    }
    .dsh-npm-tab {
      padding: 10px 16px;
      margin-bottom: -1px;
      font-size: 14px;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary, #666);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: color 0.15s, border-color 0.15s;
    }
    .dsh-npm-tab:hover {
      color: var(--dsw-alias-label-primary, #333);
    }
    .dsh-npm-tab.active {
      color: var(--dsw-alias-brand-primary, var(--dsw-alias-state-business-primary, #1a6ff5));
      border-bottom-color: var(--dsw-alias-brand-primary, var(--dsw-alias-state-business-primary, #1a6ff5));
      font-weight: 500;
    }

    /* ---- buttons ---- */
    .dsh-npm-btn {
      appearance: none;
      font: inherit;
      cursor: pointer;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 5px 14px;
      font-size: 13px;
      line-height: 1.5;
      transition: background 0.15s, border-color 0.15s, color 0.15s, opacity 0.15s;
    }
    .dsh-npm-btn:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .dsh-npm-btn-primary {
      background: var(--dsw-alias-brand-primary, var(--dsw-alias-state-business-primary, #1a6ff5));
      color: var(--dsw-alias-text-on-primary, #fff);
    }
    .dsh-npm-btn-primary:hover:not(:disabled) {
      opacity: 0.88;
    }
    .dsh-npm-btn-ghost {
      background: transparent;
      border-color: var(--dsw-alias-border-l2, #ddd);
      color: var(--dsw-alias-label-primary, #333);
    }
    .dsh-npm-btn-ghost:hover:not(:disabled) {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.04));
      border-color: var(--dsw-alias-label-dimmed, #bbb);
    }
    .dsh-npm-btn-danger {
      background: transparent;
      border-color: var(--dsw-alias-state-error-primary, #c62828);
      color: var(--dsw-alias-state-error-primary, #c62828);
    }
    .dsh-npm-btn-danger:hover:not(:disabled) {
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #c62828) 8%, transparent);
    }
    .dsh-npm-btn-sm {
      padding: 3px 10px;
      font-size: 12px;
      border-radius: 6px;
    }

    /* ---- table ---- */
    .dsh-npm-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .dsh-npm-table th {
      text-align: left;
      padding: 8px 12px;
      background: var(--dsw-alias-bg-layer-1, #f5f5f5);
      border-bottom: 1px solid var(--dsw-alias-border-l2, #ddd);
      font-weight: 600;
      font-size: 12px;
      color: var(--dsw-alias-label-secondary, #666);
      white-space: nowrap;
    }
    .dsh-npm-table td {
      padding: 9px 12px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, #eee);
      color: var(--dsw-alias-label-primary, #333);
    }
    .dsh-npm-table tr:hover td {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.03));
    }

    /* ---- status pills ---- */
    .dsh-npm-status {
      display: inline-block;
      padding: 1px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      line-height: 18px;
      white-space: nowrap;
    }
    .dsh-npm-status.valid {
      color: var(--dsw-alias-state-success-primary, #2e7d32);
      background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #2e7d32) 12%, transparent);
    }
    .dsh-npm-status.invalid {
      color: var(--dsw-alias-state-error-primary, #c62828);
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #c62828) 10%, transparent);
    }
    .dsh-npm-status.pending {
      color: var(--dsw-alias-label-secondary, #666);
      background: var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, 0.12));
    }

    /* ---- feedback boxes ---- */
    .dsh-npm-error {
      padding: 8px 12px;
      margin-bottom: 16px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--dsw-alias-state-error-primary, #c62828);
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #c62828) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #c62828) 20%, transparent);
    }
    .dsh-npm-feedback {
      margin-top: 12px;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13px;
      line-height: 1.5;
    }
    .dsh-npm-feedback.error {
      color: var(--dsw-alias-state-error-primary, #c62828);
      background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #c62828) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #c62828) 20%, transparent);
    }
    .dsh-npm-feedback.warning {
      color: var(--dsw-alias-state-warn-primary, #e65100);
      background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e65100) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary, #e65100) 20%, transparent);
    }
    .dsh-npm-feedback ul {
      margin: 4px 0 0;
      padding-left: 20px;
    }

    /* ---- card / form ---- */
    .dsh-npm-card {
      border: 1px solid var(--dsw-alias-border-l2, #ddd);
      border-radius: 12px;
      padding: 16px;
      background: var(--dsw-alias-bg-layer-2, #fff);
      margin-bottom: 16px;
    }
    .dsh-npm-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .dsh-npm-form-row {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    .dsh-npm-form-row label {
      min-width: 80px;
      flex: none;
      font-size: 13px;
      color: var(--dsw-alias-label-secondary, #666);
    }
    .dsh-npm-form-row input {
      flex: 1;
      min-width: 0;
      height: 34px;
      box-sizing: border-box;
      padding: 0 12px;
      font: inherit;
      font-size: 13px;
      line-height: 1.5;
      border: 1px solid var(--dsw-alias-border-l2, #ccc);
      border-radius: 8px;
      background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2, #fff));
      color: var(--dsw-alias-label-primary, #111);
    }
    .dsh-npm-form-row input:focus-visible {
      border-color: var(--dsw-alias-brand-primary, var(--dsw-alias-state-business-primary, #1a6ff5));
      outline: none;
    }
    .dsh-npm-form-row input:disabled {
      color: var(--dsw-alias-label-tertiary, #999);
      cursor: default;
    }

    /* ---- empty state ---- */
    .dsh-npm-empty {
      text-align: center;
      padding: 48px 20px;
      font-size: 13px;
      color: var(--dsw-alias-label-tertiary, #999);
    }
  `
  document.head.appendChild(style)
}

// ========== API Helpers ==========

interface FetchError extends Error {
  data?: any
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `请求失败: ${res.status}`) as FetchError
    err.data = data
    throw err
  }
  return data as T
}

// ========== Overlay Open State (bridges DOM row <-> React modal) ==========

const overlayStore = {
  open: false,
  listeners: new Set<() => void>(),
  setOpen(next: boolean) {
    if (this.open === next) return
    this.open = next
    for (const listener of this.listeners) listener()
  },
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  },
}

// ========== Sidebar Entry (DOM injection, shell has no official slot) ==========

const SIDEBAR_ENTRY_SELECTOR = '[data-dsh-npm-entry]'
const FAMILY_SELECTORS = ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]', '[data-dsh-npm-entry]']

/** Inline package/cube icon normalized to the shell's 18px navigation glyph size. */
const SIDEBAR_ICON =
  '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5 14 4.8v6.4L8 14.5 2 11.2V4.8L8 1.5Z"/><path d="M2 4.8 8 8l6-3.2"/><path d="M8 8v6.5"/></svg>'

/** Find the sidebar shell root element, or undefined while not yet mounted. */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  return (
    (column.querySelector('[class*="logoRow"]')?.parentElement as HTMLElement | null) ??
    (column.firstElementChild as HTMLElement | null) ??
    undefined
  )
}

/** The New Session button: nested in the logo row on current shells, a direct child on legacy shells. */
function newSessionButton(root: HTMLElement): HTMLElement | undefined {
  const nested = root.querySelector('button[class*="newSession"]')
  if (nested !== null) return nested as HTMLElement
  for (const child of Array.from(root.children)) {
    if (child.tagName === 'BUTTON') return child as HTMLElement
  }
  return undefined
}

/** Re-insert the entry directly after the New Session row and any existing plugin family rows. */
function placeEntry(root: HTMLElement, entry: HTMLElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  const row = button.closest('[class*="logoRow"]')
  const base = row !== null && row.parentElement === root ? (row as HTMLElement) : button
  const family = Array.from(root.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && el.matches(FAMILY_SELECTORS.join(', ')),
  )
  const anchor =
    family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
  if (entry.parentElement === root && entry.nextElementSibling === anchor) return true
  root.insertBefore(entry, anchor)
  return true
}

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders. Returns a disposer removing the row and observers.
 */
function mountSidebarEntry(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(SIDEBAR_ENTRY_SELECTOR) !== null) return () => {}

  const entry = document.createElement('button')
  entry.type = 'button'
  entry.setAttribute('data-dsh-npm-entry', '')
  entry.className = 'dsh-npm-sidebar-entry'
  entry.title = 'npm 包管理'
  entry.setAttribute('aria-label', 'npm 包管理')
  entry.innerHTML = `<span class="dsh-npm-sidebar-entry-icon">${SIDEBAR_ICON}</span><span class="dsh-npm-sidebar-entry-label">npm 包管理</span>`
  entry.addEventListener('click', () => overlayStore.setOpen(true))

  const syncActive = () => {
    if (overlayStore.open) entry.setAttribute('data-active', 'true')
    else entry.removeAttribute('data-active')
  }
  const unsubscribeActive = overlayStore.subscribe(syncActive)
  syncActive()

  let root: HTMLElement | undefined
  let placed = false

  const tryPlace = () => {
    if (root !== undefined && !root.isConnected) {
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    if (placed && document.body.contains(entry)) return
    if (placed) {
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) rootObserver.observe(root, { childList: true, subtree: true })
  }

  const waitObserver = new MutationObserver(() => {
    tryPlace()
  })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) placed = placeEntry(root, entry)
  })

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribeActive()
    entry.remove()
  }
}

// ========== Overlay Host (own React root; the DOM row toggles it) ==========

function NpmOverlayHost() {
  const [open, setOpen] = useState(overlayStore.open)

  useEffect(() => overlayStore.subscribe(() => setOpen(overlayStore.open)), [])

  return (
    <Modal
      open={open}
      onClose={() => overlayStore.setOpen(false)}
      title="npm 包管理"
      closeLabel="关闭"
      className="dsh-npm-overlay"
    >
      <NpmManagerOverlay />
    </Modal>
  )
}

function mountOverlayHost(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector('[data-dsh-npm-overlay-root]') !== null) return () => {}
  const container = document.createElement('div')
  container.setAttribute('data-dsh-npm-overlay-root', '')
  document.body.appendChild(container)
  const root = createOverlayRoot(container)
  root.render(<NpmOverlayHost />)
  return () => {
    root.unmount()
    container.remove()
  }
}

// ========== Native Directory Picker (optional uiWorkspace service) ==========

/** Bound in apply() when the uiWorkspace service is available; null on web-only deployments. */
let directoryPicker: (() => Promise<string | null>) | null = null

// ========== Main Component ==========

function NpmManagerOverlay() {
  const [activeTab, setActiveTab] = useState<'remote' | 'local'>('remote')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '4px 24px 0' }}>
        <div className="dsh-npm-tabs">
          <button
            className={`dsh-npm-tab ${activeTab === 'remote' ? 'active' : ''}`}
            onClick={() => setActiveTab('remote')}
          >
            远端包
          </button>
          <button
            className={`dsh-npm-tab ${activeTab === 'local' ? 'active' : ''}`}
            onClick={() => setActiveTab('local')}
          >
            本地包
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '0 24px 24px' }}>
        {activeTab === 'remote' ? <RemotePackagesTab /> : <LocalPackagesTab />}
      </div>
    </div>
  )
}

// ========== Remote Packages Tab ==========

function RemotePackagesTab() {
  const [packages, setPackages] = useState<RemotePackage[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

  const loadPackages = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson<{ packages: RemotePackage[] }>(
        '/plugins/dsh-plugin-npm/packages/remote',
      )
      setPackages(data.packages)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPackages()
  }, [loadPackages])

  const handleSync = async () => {
    setSyncing(true)
    setError('')
    try {
      // sync-all 返回 { results: SyncResult[] }；单 registry 返回裸 SyncResult
      const data = await fetchJson<{ results?: SyncResult[] } & Partial<SyncResult>>(
        '/plugins/dsh-plugin-npm/sync',
      )
      const results: SyncResult[] = Array.isArray(data.results)
        ? data.results
        : typeof data.success === 'boolean'
          ? [data as SyncResult]
          : []
      const failed = results.filter(r => !r.success)
      if (failed.length > 0) {
        setError(failed.map(f => f.error || `${f.registryId} 同步失败`).join('; '))
      } else if (results.length === 0) {
        setError('没有启用同步的 registry')
      } else {
        await loadPackages()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

  if (loading) {
    return <div className="dsh-npm-empty">加载中...</div>
  }

  return (
    <div>
      <div className="dsh-npm-toolbar">
        <div className="dsh-npm-count">共 {packages.length} 个包</div>
        <button onClick={handleSync} disabled={syncing} className="dsh-npm-btn dsh-npm-btn-ghost">
          {syncing ? '同步中...' : '同步'}
        </button>
      </div>

      {error && <div className="dsh-npm-error">{error}</div>}

      {packages.length === 0 ? (
        <div className="dsh-npm-empty">
          暂无包数据，请先同步
        </div>
      ) : (
        <table className="dsh-npm-table">
          <thead>
            <tr>
              <th>包名</th>
              <th>版本</th>
              <th>描述</th>
              <th>月下载量</th>
              <th>更新时间</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => (
              <tr key={`${pkg.registryId}:${pkg.name}`}>
                <td>
                  <a
                    href={`https://www.npmjs.com/package/${pkg.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--dsw-alias-brand-primary, var(--dsw-alias-state-business-primary, #1a6ff5))', textDecoration: 'none' }}
                  >
                    {pkg.name}
                  </a>
                </td>
                <td>{pkg.version}</td>
                <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pkg.description}
                </td>
                <td>{formatNumber(pkg.downloadsMonthly)}</td>
                <td>{formatDate(pkg.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ========== Local Packages Tab ==========

function LocalPackagesTab() {
  const [packages, setPackages] = useState<LocalPackage[]>([])
  const [loading, setLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addPath, setAddPath] = useState('')
  const [adding, setAdding] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [validation, setValidation] = useState<ValidationResult | null>(null)

  const loadPackages = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchJson<{ packages: LocalPackage[] }>(
        '/plugins/dsh-plugin-npm/packages/local',
      )
      setPackages(data.packages)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPackages()
  }, [loadPackages])

  const doAdd = useCallback(
    async (path: string) => {
      if (!path) return

      setAdding(true)
      setError('')
      setValidation(null)

      try {
        const data = await fetchJson<{ package: LocalPackage; validation: ValidationResult }>(
          '/plugins/dsh-plugin-npm/packages/local/add',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path }),
          },
        )

        setValidation(data.validation)

        if (data.validation.valid) {
          setShowAddForm(false)
          setAddPath('')
          await loadPackages()
        }
      } catch (err: any) {
        // 服务器在 400 中附带完整 validation，展示具体错误/警告
        if (err.data?.validation) {
          setValidation(err.data.validation)
        }
        setError(err.message)
      } finally {
        setAdding(false)
      }
    },
    [loadPackages],
  )

  const handleAdd = () => doAdd(addPath.trim())

  const handlePickDirectory = async () => {
    if (!directoryPicker) return
    try {
      const picked = await directoryPicker()
      if (picked === null) return // 用户取消，不视为错误
      setAddPath(picked)
      // 自动触发与“添加”相同的验证流程，让用户立即看到验证反馈
      await doAdd(picked)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个本地包吗？')) return

    setPendingId(id)
    try {
      await fetchJson(`/plugins/dsh-plugin-npm/packages/local/delete?id=${encodeURIComponent(id)}`)
      await loadPackages()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  const handleValidate = async (id: string) => {
    setPendingId(id)
    try {
      const data = await fetchJson<{ package: LocalPackage; validation: ValidationResult }>(
        `/plugins/dsh-plugin-npm/packages/local/validate?id=${encodeURIComponent(id)}`,
      )
      await loadPackages()
      alert(data.validation.valid ? '验证通过' : `验证失败: ${data.validation.errors.join(', ')}`)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  const handlePublish = async (id: string) => {
    if (!confirm('确定要发布这个包吗？')) return

    setPendingId(id)
    try {
      const data = await fetchJson<PublishResult>(
        '/plugins/dsh-plugin-npm/packages/local/publish',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        },
      )

      if (data.success) {
        alert(`发布成功: ${data.packageName}@${data.version}`)
      } else {
        alert(`发布失败: ${data.error}`)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setPendingId(null)
    }
  }

  if (loading) {
    return <div className="dsh-npm-empty">加载中...</div>
  }

  return (
    <div>
      <div className="dsh-npm-toolbar">
        <div className="dsh-npm-count">共 {packages.length} 个本地包</div>
        <button onClick={() => setShowAddForm(!showAddForm)} className="dsh-npm-btn dsh-npm-btn-primary">
          {showAddForm ? '取消' : '添加本地包'}
        </button>
      </div>

      {error && <div className="dsh-npm-error">{error}</div>}

      {showAddForm && (
        <div className="dsh-npm-card">
          <div className="dsh-npm-form">
            <div className="dsh-npm-form-row">
              <label>包路径</label>
              <input
                type="text"
                value={addPath}
                onChange={(e) => setAddPath(e.target.value)}
                placeholder="/path/to/your/package"
                disabled={adding}
              />
              {directoryPicker !== null && (
                <button
                  onClick={handlePickDirectory}
                  disabled={adding}
                  className="dsh-npm-btn dsh-npm-btn-ghost"
                  style={{ flex: 'none' }}
                >
                  选择文件夹
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleAdd}
                disabled={adding || !addPath.trim()}
                className="dsh-npm-btn dsh-npm-btn-primary"
              >
                {adding ? '添加中...' : '添加'}
              </button>
            </div>
          </div>

          {validation && !validation.valid && (
            <div className="dsh-npm-feedback error">
              <div style={{ fontWeight: 600 }}>验证失败:</div>
              <ul>
                {validation.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {validation && validation.warnings.length > 0 && (
            <div className="dsh-npm-feedback warning">
              <div style={{ fontWeight: 600 }}>警告:</div>
              <ul>
                {validation.warnings.map((warn, i) => (
                  <li key={i}>{warn}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {packages.length === 0 ? (
        <div className="dsh-npm-empty">
          暂无本地包，点击"添加本地包"开始
        </div>
      ) : (
        <table className="dsh-npm-table">
          <thead>
            <tr>
              <th>包名</th>
              <th>版本</th>
              <th>路径</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((pkg) => (
              <tr key={pkg.id}>
                <td>{pkg.name}</td>
                <td>{pkg.version || '-'}</td>
                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pkg.path}>
                  {pkg.path}
                </td>
                <td>
                  <span className={`dsh-npm-status ${pkg.status}`}>
                    {pkg.status === 'valid' ? '有效' : pkg.status === 'invalid' ? '无效' : '待验证'}
                  </span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleValidate(pkg.id)}
                      disabled={pendingId === pkg.id}
                      className="dsh-npm-btn dsh-npm-btn-ghost dsh-npm-btn-sm"
                    >
                      {pendingId === pkg.id ? '处理中...' : '验证'}
                    </button>
                    {pkg.status === 'valid' && (
                      <button
                        onClick={() => handlePublish(pkg.id)}
                        disabled={pendingId === pkg.id}
                        className="dsh-npm-btn dsh-npm-btn-primary dsh-npm-btn-sm"
                      >
                        {pendingId === pkg.id ? '发布中...' : '发布'}
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(pkg.id)}
                      disabled={pendingId === pkg.id}
                      className="dsh-npm-btn dsh-npm-btn-danger dsh-npm-btn-sm"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ========== Settings Section ==========

function NpmSettingsSection(props: any) {
  const snap = props.useNpm((s: any) => s)

  if (snap.status === 'unavailable') {
    return (
      <div style={{ padding: 12, fontSize: 13, color: 'var(--dsw-alias-label-tertiary, #888)' }}>
        npm settings are unavailable on this connection.
      </div>
    )
  }

  if (snap.status !== 'ready' || snap.value === undefined) {
    return <div style={{ padding: 12, fontSize: 13, color: 'var(--dsw-alias-label-tertiary, #888)' }}>Loading npm settings...</div>
  }

  const v = snap.value
  const set = (field: string) => (value: unknown) => props.setField(field, value)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 620 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>npm 包管理</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--dsw-alias-label-tertiary, #999)' }}>
          管理你的 npm 包、配置 registry 和同步设置
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Registry 配置</h3>
        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary, #666)' }}>
          Registry 通过 /plugins/dsh-plugin-npm/registries API 管理（存储在插件数据库中），
          不在此处配置。
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>自动同步</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={v.autoSync.enabled}
            onChange={(e) => set('autoSync')({ ...v.autoSync, enabled: e.target.checked })}
          />
          <span>启用自动同步</span>
        </label>
        {v.autoSync.enabled && (
          <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary, #666)' }}>
            同步间隔: {Math.round(v.autoSync.intervalMs / 60000)} 分钟
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>数据源优先级</h3>
        <select
          value={v.sourcePriority}
          onChange={(e) => set('sourcePriority')(e.target.value)}
          style={{
            padding: '6px 10px',
            fontSize: 13,
            borderRadius: 6,
            border: '1px solid var(--dsw-alias-border-l2, #ccc)',
            background: 'var(--dsw-alias-bg-layer-2, #fff)',
            color: 'var(--dsw-alias-label-primary, #111)',
          }}
        >
          <option value="cli-first">CLI 优先（推荐）</option>
          <option value="api-first">API 优先</option>
          <option value="cache-only">仅缓存</option>
        </select>
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)' }}>
          CLI 优先：优先使用 npm CLI，不可用时回退到 HTTP API
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>默认发布 Tag</h3>
        <input
          type="text"
          value={v.defaultPublishTag}
          onChange={(e) => set('defaultPublishTag')(e.target.value)}
          placeholder="latest"
          style={{
            padding: '6px 10px',
            fontSize: 13,
            borderRadius: 6,
            border: '1px solid var(--dsw-alias-border-l2, #ccc)',
            background: 'var(--dsw-alias-bg-layer-2, #fff)',
            color: 'var(--dsw-alias-label-primary, #111)',
            maxWidth: 240,
          }}
        />
        <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)' }}>
          发布时未指定 tag 时使用的默认 dist-tag（通常为 latest）
        </div>
      </div>
    </div>
  )
}

// ========== Utility Functions ==========

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`
  }
  return num.toString()
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days}天前`
  if (days < 30) return `${Math.floor(days / 7)}周前`
  if (days < 365) return `${Math.floor(days / 30)}个月前`
  return `${Math.floor(days / 365)}年前`
}

// ========== Plugin Entry ==========

export function apply(ctx: any) {
  installStyles()

  // 绑定原生目录选择器（web-only 部署没有 uiWorkspace 服务时保持 null，隐藏按钮）
  try {
    const uiWorkspace = ctx.get?.('uiWorkspace', false)
    if (uiWorkspace && typeof uiWorkspace.pickDirectory === 'function') {
      directoryPicker = () => uiWorkspace.pickDirectory()
    }
  } catch {
    directoryPicker = null
  }

  const scope = ctx.settingsScope.bind({ namespace: NS })
  const snapshot = () => scope.getSnapshot()
  const subscribe = (listener: () => void) => scope.subscribe(listener)

  // 注册设置页面
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'npm',
        order: 150,
        label: () => 'npm',
        inject: () => ({
          hooks: { npm: { getSnapshot: snapshot, subscribe } },
          setField: (field: string, value: unknown) => scope.set(field, value),
        }),
      },
      NpmSettingsSection,
    ),
  )

  // 侧边栏入口：shell 没有官方 slot，通过 DOM 注入到 New Session 行下方
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry())
    disposers.push(mountOverlayHost())
  } catch (error) {
    console.error('[dsh-plugin-npm] sidebar mount failed:', error)
  }
  ctx.on('dispose', () => {
    for (const dispose of disposers.splice(0)) dispose()
  })
}
