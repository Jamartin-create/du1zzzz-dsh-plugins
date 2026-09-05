import { randomUUID } from 'crypto'
import { NpmDatabase } from './sqlite'
import { DataSource } from './data-source'
import type { NpmConfig, RegistryConfigInput } from './config'
import type { SyncLog } from './types'

export interface SyncResult {
  success: boolean
  registryId: string
  packagesCount: number
  error?: string
}

export class SyncManager {
  private db: NpmDatabase
  private dataSource: DataSource
  private config: NpmConfig
  private syncTimers: Map<string, NodeJS.Timeout> = new Map()
  private logger: any

  constructor(db: NpmDatabase, dataSource: DataSource, config: NpmConfig, logger?: any) {
    this.db = db
    this.dataSource = dataSource
    this.config = config
    this.logger = logger
  }

  /**
   * 更新配置
   */
  updateConfig(config: NpmConfig) {
    this.config = config
    // 重启定时同步
    this.stopAutoSync()
    if (config.autoSync.enabled) {
      this.startAutoSync()
    }
  }

  /**
   * 启动自动同步
   */
  startAutoSync() {
    const { registries, autoSync } = this.config
    if (!autoSync.enabled) return

    for (const registry of registries) {
      if (registry.syncEnabled) {
        this.scheduleSync(registry, autoSync.intervalMs)
      }
    }
  }

  /**
   * 停止自动同步
   */
  stopAutoSync() {
    for (const timer of this.syncTimers.values()) {
      clearInterval(timer)
    }
    this.syncTimers.clear()
  }

  /**
   * 调度定时同步
   */
  private scheduleSync(registry: RegistryConfigInput, intervalMs: number) {
    // 清除旧的定时器
    const oldTimer = this.syncTimers.get(registry.id)
    if (oldTimer) {
      clearInterval(oldTimer)
    }

    // 立即执行一次同步
    this.syncRegistry(registry).catch(err => {
      this.logger?.warn?.(`dsh-plugin-npm: 同步 ${registry.name} 失败:`, err.message)
    })

    // 设置定时器
    const timer = setInterval(() => {
      this.syncRegistry(registry).catch(err => {
        this.logger?.warn?.(`dsh-plugin-npm: 同步 ${registry.name} 失败:`, err.message)
      })
    }, intervalMs)

    this.syncTimers.set(registry.id, timer)
  }

  /**
   * 同步指定 registry
   */
  async syncRegistry(registry: RegistryConfigInput): Promise<SyncResult> {
    const syncId = randomUUID()
    const syncLog: SyncLog = {
      id: syncId,
      registryId: registry.id,
      startedAt: new Date().toISOString(),
      status: 'success',
    }

    this.db.addSyncLog(syncLog)
    this.logger?.info?.(`dsh-plugin-npm: 开始同步 ${registry.name}...`)

    try {
      // 获取用户名
      const username = await this.dataSource.getUsername({
        priority: this.config.sourcePriority,
        registry,
      })

      // 获取包列表
      const packages = await this.dataSource.getUserPackages(username, {
        priority: this.config.sourcePriority,
        registry,
      })

      // 清空旧数据并写入新数据
      this.db.clearRemotePackages(registry.id)
      for (const pkg of packages) {
        this.db.upsertRemotePackage(pkg)
      }

      // 更新同步记录
      syncLog.finishedAt = new Date().toISOString()
      syncLog.packagesCount = packages.length
      this.db.updateSyncLog(syncLog)

      this.logger?.info?.(`dsh-plugin-npm: 同步 ${registry.name} 完成，共 ${packages.length} 个包`)

      return {
        success: true,
        registryId: registry.id,
        packagesCount: packages.length,
      }
    } catch (error: any) {
      syncLog.finishedAt = new Date().toISOString()
      syncLog.status = 'error'
      syncLog.errorMessage = error.message
      this.db.updateSyncLog(syncLog)

      this.logger?.warn?.(`dsh-plugin-npm: 同步 ${registry.name} 失败:`, error.message)

      return {
        success: false,
        registryId: registry.id,
        packagesCount: 0,
        error: error.message,
      }
    }
  }

  /**
   * 同步所有启用的 registry
   */
  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    const { registries } = this.config

    for (const registry of registries) {
      if (registry.syncEnabled && registry.authToken) {
        const result = await this.syncRegistry(registry)
        results.push(result)
      }
    }

    return results
  }

  /**
   * 刷新单个包的信息
   */
  async refreshPackage(packageName: string, registryId?: string): Promise<void> {
    const registry = registryId
      ? this.config.registries.find(r => r.id === registryId)
      : this.config.registries.find(r => r.isDefault)

    if (!registry) {
      throw new Error('找不到对应的 registry')
    }

    const pkg = await this.dataSource.getPackageDetails(packageName, {
      priority: this.config.sourcePriority,
      registry,
    })

    if (pkg) {
      this.db.upsertRemotePackage(pkg)
    }
  }
}
