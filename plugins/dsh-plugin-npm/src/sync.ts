import { randomUUID } from 'crypto'
import { NpmDatabase } from './sqlite'
import { DataSource } from './data-source'
import type { NpmConfig } from './config'
import type { RegistryConfig, SyncLog } from './types'

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
  private inFlight: Set<string> = new Set()
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
    const { autoSync } = this.config
    if (!autoSync.enabled) return

    for (const registry of this.db.getRegistries()) {
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
  private scheduleSync(registry: RegistryConfig, intervalMs: number) {
    // 清除旧的定时器
    const oldTimer = this.syncTimers.get(registry.id)
    if (oldTimer) {
      clearInterval(oldTimer)
    }

    // 立即执行一次同步
    this.syncRegistry(registry).catch(err => {
      this.logger?.warn?.(`dsh-plugin-npm: 同步 ${registry.name} 失败:`, err.message)
    })

    // 设置定时器（上一轮仍在进行时跳过本次 tick）
    const timer = setInterval(() => {
      if (this.inFlight.has(registry.id)) return
      this.syncRegistry(registry).catch(err => {
        this.logger?.warn?.(`dsh-plugin-npm: 同步 ${registry.name} 失败:`, err.message)
      })
    }, intervalMs)

    this.syncTimers.set(registry.id, timer)
  }

  /**
   * 同步指定 registry
   */
  async syncRegistry(registry: RegistryConfig): Promise<SyncResult> {
    if (this.inFlight.has(registry.id)) {
      return {
        success: false,
        registryId: registry.id,
        packagesCount: 0,
        error: '该 registry 已有同步任务正在进行',
      }
    }
    this.inFlight.add(registry.id)

    const syncId = randomUUID()
    const syncLog: SyncLog = {
      id: syncId,
      registryId: registry.id,
      startedAt: new Date().toISOString(),
      status: 'success',
    }

    try {
      this.safeAddSyncLog(syncLog)
      this.logger?.info?.(`dsh-plugin-npm: 开始同步 ${registry.name}...`)

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
      this.safeUpdateSyncLog(syncLog)

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
      this.safeUpdateSyncLog(syncLog)

      this.logger?.warn?.(`dsh-plugin-npm: 同步 ${registry.name} 失败:`, error.message)

      return {
        success: false,
        registryId: registry.id,
        packagesCount: 0,
        error: error.message,
      }
    } finally {
      this.inFlight.delete(registry.id)
    }
  }

  /**
   * 同步所有启用同步的 registry。
   * 未配置 authToken 不跳过——让该 registry 的同步以自己的错误呈现。
   */
  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    for (const registry of this.db.getRegistries()) {
      if (registry.syncEnabled) {
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
      ? this.db.getRegistry(registryId)
      : this.db.getDefaultRegistry()

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

  /**
   * 日志写入失败不应改变同步结果，仅记录警告
   */
  private safeAddSyncLog(log: SyncLog) {
    try {
      this.db.addSyncLog(log)
    } catch (error: any) {
      this.logger?.warn?.('dsh-plugin-npm: 写入同步记录失败:', error.message)
    }
  }

  private safeUpdateSyncLog(log: SyncLog) {
    try {
      this.db.updateSyncLog(log)
    } catch (error: any) {
      this.logger?.warn?.('dsh-plugin-npm: 更新同步记录失败:', error.message)
    }
  }
}
