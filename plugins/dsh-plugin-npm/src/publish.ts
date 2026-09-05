import { randomUUID } from 'crypto'
import { join } from 'path'
import { rm } from 'fs/promises'
import { NpmDatabase } from './sqlite'
import { DataSource } from './data-source'
import { validateLocalPackage, readPackageJson } from './validator'
import type { NpmConfig } from './config'
import type { LocalPackage, PublishLog, RegistryConfig } from './types'

export interface PublishOptions {
  localPackageId: string
  tag?: string
  otp?: string
  dryRun?: boolean
}

export interface PublishResult {
  success: boolean
  packageName?: string
  version?: string
  registryId?: string
  error?: string
}

export class PublishManager {
  private db: NpmDatabase
  private dataSource: DataSource
  private config: NpmConfig
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
  }

  /**
   * 发布本地包
   */
  async publish(options: PublishOptions): Promise<PublishResult> {
    const { localPackageId, tag, otp, dryRun } = options

    // 获取本地包信息
    const localPkg = this.db.getLocalPackage(localPackageId)
    if (!localPkg) {
      return { success: false, error: '本地包不存在' }
    }

    // 验证包
    const validation = await validateLocalPackage(localPkg.path)
    if (!validation.valid) {
      return {
        success: false,
        packageName: localPkg.name,
        error: `包验证失败: ${validation.errors.join(', ')}`,
      }
    }

    // 确定目标 registry
    const registry = this.resolveRegistry(localPkg)
    if (!registry) {
      return {
        success: false,
        packageName: localPkg.name,
        error: '找不到对应的 registry，请配置 authToken',
      }
    }

    if (!registry.authToken) {
      return {
        success: false,
        packageName: localPkg.name,
        error: `registry ${registry.name} 未配置 authToken`,
      }
    }

    // 读取 package.json 获取版本
    const pkgJson = readPackageJson(localPkg.path)
    if (!pkgJson) {
      return {
        success: false,
        packageName: localPkg.name,
        error: '无法读取 package.json',
      }
    }

    const publishId = randomUUID()
    const publishLog: PublishLog = {
      id: publishId,
      localPackageId,
      packageName: pkgJson.name,
      version: pkgJson.version,
      registryId: registry.id,
      status: 'success',
      publishedAt: new Date().toISOString(),
    }

    if (dryRun) {
      this.logger?.info?.(`dsh-plugin-npm: dry-run 发布 ${pkgJson.name}@${pkgJson.version} 到 ${registry.name}`)
      return {
        success: true,
        packageName: pkgJson.name,
        version: pkgJson.version,
        registryId: registry.id,
      }
    }

    let tarballPath: string | undefined

    try {
      // 打包
      this.logger?.info?.(`dsh-plugin-npm: 开始打包 ${pkgJson.name}@${pkgJson.version}...`)
      const tarball = await this.dataSource.pack(localPkg.path, {
        priority: this.config.sourcePriority,
        registry,
      })
      tarballPath = join(localPkg.path, tarball)
      publishLog.tarballPath = tarballPath

      // 发布
      this.logger?.info?.(`dsh-plugin-npm: 开始发布 ${pkgJson.name}@${pkgJson.version} 到 ${registry.name}...`)
      await this.dataSource.publish(localPkg.path, {
        priority: this.config.sourcePriority,
        registry,
        tag: tag || this.config.defaultPublishTag,
        otp,
      })

      // 记录发布日志（日志写入失败不影响已成功的发布结果）
      this.safeAddPublishLog(publishLog)

      // 更新本地包版本（失败仅告警，不翻转发布结果）
      try {
        localPkg.version = pkgJson.version
        localPkg.updatedAt = new Date().toISOString()
        this.db.updateLocalPackage(localPkg)
      } catch (error: any) {
        this.logger?.warn?.('dsh-plugin-npm: 更新本地包记录失败:', error.message)
      }

      this.logger?.info?.(`dsh-plugin-npm: 发布成功 ${pkgJson.name}@${pkgJson.version}`)

      return {
        success: true,
        packageName: pkgJson.name,
        version: pkgJson.version,
        registryId: registry.id,
      }
    } catch (error: any) {
      publishLog.status = 'error'
      publishLog.errorMessage = error.message
      this.safeAddPublishLog(publishLog)

      this.logger?.warn?.(`dsh-plugin-npm: 发布失败 ${pkgJson.name}:`, error.message)

      return {
        success: false,
        packageName: pkgJson.name,
        version: pkgJson.version,
        registryId: registry.id,
        error: error.message,
      }
    } finally {
      // 清理打包产生的 tarball，避免在用户包目录中累积
      if (tarballPath) {
        await rm(tarballPath, { force: true }).catch(() => {})
      }
    }
  }

  /**
   * 取消发布
   */
  async unpublish(
    packageName: string,
    version: string,
    registryId?: string,
  ): Promise<{ success: boolean; error?: string }> {
    const registry = registryId
      ? this.db.getRegistry(registryId)
      : this.db.getDefaultRegistry()

    if (!registry) {
      return { success: false, error: '找不到对应的 registry' }
    }

    if (!registry.authToken) {
      return { success: false, error: `registry ${registry.name} 未配置 authToken` }
    }

    try {
      await this.dataSource.unpublish(packageName, version, {
        priority: this.config.sourcePriority,
        registry,
      })

      this.logger?.info?.(`dsh-plugin-npm: 取消发布成功 ${packageName}@${version}`)
      return { success: true }
    } catch (error: any) {
      this.logger?.warn?.(`dsh-plugin-npm: 取消发布失败 ${packageName}@${version}:`, error.message)
      return { success: false, error: error.message }
    }
  }

  /**
   * 解析目标 registry（registries 的唯一真实来源是 sqlite registries 表）
   */
  private resolveRegistry(localPkg: LocalPackage): RegistryConfig | undefined {
    // 1. 优先使用本地包指定的 registry
    if (localPkg.registryId) {
      const registry = this.db.getRegistry(localPkg.registryId)
      if (registry) return registry
    }

    // 2. 根据 scope 匹配
    if (localPkg.name.startsWith('@')) {
      const scope = localPkg.name.split('/')[0]
      const registry = this.db.getRegistryByScope(scope)
      if (registry) return registry
    }

    // 3. 使用默认 registry
    return this.db.getDefaultRegistry()
  }

  /**
   * 发布日志写入失败不应改变发布结果，仅记录警告
   */
  private safeAddPublishLog(log: PublishLog) {
    try {
      this.db.addPublishLog(log)
    } catch (error: any) {
      this.logger?.warn?.('dsh-plugin-npm: 写入发布记录失败:', error.message)
    }
  }
}
