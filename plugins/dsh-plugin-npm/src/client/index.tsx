import { useEffect, useState, useCallback, type CSSProperties } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'

/** Settings namespace owned by the Host half of this plugin. */
const NS = 'dsh-plugin-npm'

export const inject = ['slots', 'connection', 'settingsScope']

// ========== Types ==========

interface RemotePackage {
  name: string
  version: string
  description: string
  license: string
  homepage?: string
  repository?: string
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

interface RegistryConfig {
  id: string
  name: string
  url: string
  scope?: string
  authToken?: string
  isDefault: boolean
  syncEnabled: boolean
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
    .dsh-npm-overlay {
      min-width: 800px;
      max-width: 95vw;
      min-height: 600px;
      max-height: 90vh;
    }
    .dsh-npm-tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--dsw-alias-border-l2, #ddd);
      margin-bottom: 16px;
    }
    .dsh-npm-tab {
      padding: 8px 16px;
      font-size: 14px;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary, #666);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .dsh-npm-tab:hover {
      color: var(--dsw-alias-label-primary, #333);
    }
    .dsh-npm-tab.active {
      color: var(--dsw-alias-state-business-primary, #1a6ff5);
      border-bottom-color: var(--dsw-alias-state-business-primary, #1a6ff5);
    }
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
      color: var(--dsw-alias-label-secondary, #666);
    }
    .dsh-npm-table td {
      padding: 8px 12px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, #eee);
      color: var(--dsw-alias-label-primary, #333);
    }
    .dsh-npm-table tr:hover td {
      background: var(--dsw-alias-bg-layer-2, #fafafa);
    }
    .dsh-npm-status {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
    }
    .dsh-npm-status.valid {
      background: #e6f7e6;
      color: #2e7d32;
    }
    .dsh-npm-status.invalid {
      background: #ffeaea;
      color: #c62828;
    }
    .dsh-npm-status.pending {
      background: #fff3e0;
      color: #e65100;
    }
    .dsh-npm-empty {
      text-align: center;
      padding: 40px;
      color: var(--dsw-alias-label-tertiary, #999);
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
      font-size: 13px;
      color: var(--dsw-alias-label-secondary, #666);
    }
    .dsh-npm-form-row input {
      flex: 1;
      padding: 6px 10px;
      font-size: 13px;
      border: 1px solid var(--dsw-alias-border-l2, #ccc);
      border-radius: 6px;
      background: var(--dsw-alias-bg-layer-2, #fff);
      color: var(--dsw-alias-label-primary, #111);
    }
  `
  document.head.appendChild(style)
}

const primaryBtn: CSSProperties = {
  padding: '6px 14px',
  fontSize: 13,
  borderRadius: 8,
  border: '1px solid transparent',
  background: 'var(--dsw-alias-state-business-primary, #1a6ff5)',
  color: '#fff',
  cursor: 'pointer',
}

const ghostBtn: CSSProperties = {
  ...primaryBtn,
  background: 'transparent',
  border: '1px solid var(--dsw-alias-border-l2, #ddd)',
  color: 'var(--dsw-alias-label-primary, #333)',
}

const dangerBtn: CSSProperties = {
  ...ghostBtn,
  color: '#c62828',
  border: '1px solid #c62828',
}

// ========== API Helpers ==========

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `请求失败: ${res.status}`)
  }
  return res.json()
}

// ========== Main Component ==========

function NpmManagerOverlay() {
  const [activeTab, setActiveTab] = useState<'remote' | 'local'>('remote')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '16px 20px 0' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>npm 包管理</h2>
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
      <div style={{ flex: 1, overflow: 'auto', padding: '0 20px 20px' }}>
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
      const result = await fetchJson<SyncResult>('/plugins/dsh-plugin-npm/sync')
      if (result.success) {
        await loadPackages()
      } else {
        setError(result.error || '同步失败')
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary, #999)' }}>
          共 {packages.length} 个包
        </div>
        <button onClick={handleSync} disabled={syncing} style={ghostBtn}>
          {syncing ? '同步中...' : '同步'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 8, marginBottom: 12, background: '#ffeaea', borderRadius: 6, color: '#c62828', fontSize: 13 }}>
          {error}
        </div>
      )}

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
              <tr key={pkg.name}>
                <td>
                  <a
                    href={`https://www.npmjs.com/package/${pkg.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--dsw-alias-state-business-primary, #1a6ff5)', textDecoration: 'none' }}
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

  const handleAdd = async () => {
    if (!addPath.trim()) return

    setAdding(true)
    setError('')
    setValidation(null)

    try {
      const data = await fetchJson<{ package: LocalPackage; validation: ValidationResult }>(
        '/plugins/dsh-plugin-npm/packages/local/add',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: addPath.trim() }),
        },
      )

      setValidation(data.validation)

      if (data.validation.valid) {
        setShowAddForm(false)
        setAddPath('')
        await loadPackages()
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个本地包吗？')) return

    try {
      await fetchJson(`/plugins/dsh-plugin-npm/packages/local/delete?id=${id}`)
      await loadPackages()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleValidate = async (id: string) => {
    try {
      const data = await fetchJson<{ package: LocalPackage; validation: ValidationResult }>(
        `/plugins/dsh-plugin-npm/packages/local/validate?id=${id}`,
      )
      await loadPackages()
      alert(data.validation.valid ? '验证通过' : `验证失败: ${data.validation.errors.join(', ')}`)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handlePublish = async (id: string) => {
    if (!confirm('确定要发布这个包吗？')) return

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
    }
  }

  if (loading) {
    return <div className="dsh-npm-empty">加载中...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary, #999)' }}>
          共 {packages.length} 个本地包
        </div>
        <button onClick={() => setShowAddForm(!showAddForm)} style={primaryBtn}>
          {showAddForm ? '取消' : '添加本地包'}
        </button>
      </div>

      {error && (
        <div style={{ padding: 8, marginBottom: 12, background: '#ffeaea', borderRadius: 6, color: '#c62828', fontSize: 13 }}>
          {error}
        </div>
      )}

      {showAddForm && (
        <div style={{ padding: 16, marginBottom: 16, background: 'var(--dsw-alias-bg-layer-1, #f5f5f5)', borderRadius: 8 }}>
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
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={handleAdd} disabled={adding || !addPath.trim()} style={primaryBtn}>
                {adding ? '添加中...' : '添加'}
              </button>
            </div>
          </div>

          {validation && !validation.valid && (
            <div style={{ marginTop: 12, padding: 8, background: '#ffeaea', borderRadius: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#c62828' }}>验证失败:</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {validation.errors.map((err, i) => (
                  <li key={i} style={{ color: '#c62828', fontSize: 13 }}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {validation && validation.warnings.length > 0 && (
            <div style={{ marginTop: 8, padding: 8, background: '#fff3e0', borderRadius: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 4, color: '#e65100' }}>警告:</div>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {validation.warnings.map((warn, i) => (
                  <li key={i} style={{ color: '#e65100', fontSize: 13 }}>{warn}</li>
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
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => handleValidate(pkg.id)} style={{ ...ghostBtn, padding: '4px 8px', fontSize: 12 }}>
                      验证
                    </button>
                    {pkg.status === 'valid' && (
                      <button onClick={() => handlePublish(pkg.id)} style={{ ...primaryBtn, padding: '4px 8px', fontSize: 12 }}>
                        发布
                      </button>
                    )}
                    <button onClick={() => handleDelete(pkg.id)} style={{ ...dangerBtn, padding: '4px 8px', fontSize: 12 }}>
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
      <div style={{ padding: 12, fontSize: 13, color: '#888' }}>
        npm settings are unavailable on this connection.
      </div>
    )
  }

  if (snap.status !== 'ready' || snap.value === undefined) {
    return <div style={{ padding: 12, fontSize: 13, color: '#888' }}>Loading npm settings...</div>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Registry 配置</h3>
        {v.registries.map((registry: RegistryConfig, index: number) => (
          <div key={registry.id} style={{ padding: 12, background: 'var(--dsw-alias-bg-layer-1, #f5f5f5)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 600 }}>{registry.name}</div>
              {registry.isDefault && (
                <span style={{ fontSize: 12, color: 'var(--dsw-alias-state-business-primary, #1a6ff5)' }}>默认</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: 'var(--dsw-alias-label-secondary, #666)' }}>
              {registry.url}
            </div>
            {registry.scope && (
              <div style={{ fontSize: 12, color: 'var(--dsw-alias-label-tertiary, #999)', marginTop: 4 }}>
                Scope: {registry.scope}
              </div>
            )}
          </div>
        ))}
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
    </div>
  )
}

// ========== Sidebar Entry Component ==========

function NpmSidebarEntry() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="npm 包管理"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 32,
          height: 32,
          borderRadius: 8,
          border: 'none',
          background: 'transparent',
          color: 'var(--dsw-alias-label-secondary, #666)',
          cursor: 'pointer',
          transition: 'all 0.2s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--dsw-alias-bg-layer-1, #f0f0f0)'
          e.currentTarget.style.color = 'var(--dsw-alias-label-primary, #333)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--dsw-alias-label-secondary, #666)'
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 3H15V15H11V11H7V15H3V3Z" fill="currentColor" />
          <path d="M7 7H11V11H7V7Z" fill="var(--dsw-alias-bg-layer-2, #fff)" />
        </svg>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="npm 包管理"
        closeLabel="关闭"
        className="dsh-npm-overlay"
      >
        <NpmManagerOverlay />
      </Modal>
    </>
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

  // 注册侧边栏按钮
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'npm-manager',
        order: 200,
        label: () => 'npm',
      },
      NpmSidebarEntry,
    ),
  )
}
