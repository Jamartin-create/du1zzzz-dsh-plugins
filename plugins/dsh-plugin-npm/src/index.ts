import { join } from 'path'
import { homedir } from 'os'
import { NpmDatabase } from './sqlite'
import { DataSource } from './data-source'
import { SyncManager } from './sync'
import { PublishManager } from './publish'
import { registerTools } from './tool'
import { registerRoutes } from './routes'
import { SettingsSchema, DEFAULT_CONFIG, DEFAULT_REGISTRY, type NpmConfig } from './config'

export const name = 'dsh-plugin-npm'
export const inject = ['tools']

/** Lowercase kebab-case settings namespace */
const NS = 'dsh-plugin-npm'

const NPM_GUIDANCE = [
  'You can manage npm packages via the npm_* tools.',
  'Use npm_list_packages to see your packages, npm_view_package for details,',
  'npm_validate_package to check if a local package is ready to publish,',
  'npm_add_local_package to register a local package,',
  'npm_publish to publish a package, and npm_sync to refresh the cache.',
].join(' ')

/**
 * dsh-plugin-npm — manage npm packages from DeepSeek Harness.
 *
 * - registers npm_* tools for the agent;
 * - provides a settings namespace for sync/publish configuration;
 * - syncs remote packages to SQLite cache;
 * - manages local packages with validation and publishing;
 * - adds a sidebar button and overlay UI for package management.
 *
 * registries 的唯一真实来源是 sqlite registries 表（通过 /registries 路由管理）。
 */
export function apply(ctx: any) {
  let settings: NpmConfig = DEFAULT_CONFIG
  const getConfig = () => settings

  // 数据目录（使用 DSH 的数据目录）
  const dataDir = join(homedir(), '.dsh', 'plugins', 'dsh-plugin-npm')

  // 初始化数据库
  const db = new NpmDatabase(join(dataDir, 'npm.db'))

  // 首次启动：registries 表为空时写入默认 npmjs registry
  if (db.getRegistries().length === 0) {
    try {
      db.upsertRegistry(DEFAULT_REGISTRY)
    } catch (error: any) {
      ctx.logger?.warn?.('dsh-plugin-npm: 写入默认 registry 失败:', error.message)
    }
  }

  // 初始化数据源
  const dataSource = new DataSource()

  // 初始化同步管理器
  const syncManager = new SyncManager(db, dataSource, settings, ctx.logger)

  // 初始化发布管理器
  const publishManager = new PublishManager(db, dataSource, settings, ctx.logger)

  // 注册 settings namespace
  ctx.inject(['settings'], (settingsCtx: any) => {
    settingsCtx.effect(() => {
      const scope = settingsCtx.settings.register(NS, SettingsSchema, { applies: 'live' })
      settings = scope.get()

      const stopWatching = scope.watch((next: NpmConfig) => {
        settings = next
        syncManager.updateConfig(next)
        publishManager.updateConfig(next)
      })

      return () => {
        stopWatching()
        settings = DEFAULT_CONFIG
      }
    }, 'dsh-plugin-npm: settings namespace')
  })

  // 注册系统提示词
  ctx.inject(['systemPrompt'], (promptCtx: any) => {
    promptCtx.effect(() =>
      promptCtx.systemPrompt.section({
        name: 'npm:guidance',
        order: 900,
        text: NPM_GUIDANCE,
      }),
    )
  })

  // 注册 Agent 工具
  registerTools(ctx, {
    db,
    dataSource,
    syncManager,
    publishManager,
    getConfig,
  })

  // 注册 Web API 路由
  registerRoutes(ctx, {
    db,
    syncManager,
    publishManager,
    getConfig,
    logger: ctx.logger,
  })

  // 启动自动同步（延迟执行，等待 settings 加载）
  const autoSyncTimer = setTimeout(() => {
    if (settings.autoSync.enabled) {
      syncManager.startAutoSync()
    }
  }, 5000)

  // 清理
  ctx.on('dispose', () => {
    clearTimeout(autoSyncTimer)
    syncManager.stopAutoSync()
    db.close()
  })
}
