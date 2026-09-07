import { NpmCli, type NpmCliOptions } from './npm-cli'
import { RegistryApi, type RegistryApiOptions } from './registry-api'
import type { NpmConfig, RegistryConfigInput } from './config'
import type { RemotePackage } from './types'

export type DataSourcePriority = 'cli-first' | 'api-first' | 'cache-only'

export interface DataSourceOptions {
  priority: DataSourcePriority
  registry: RegistryConfigInput
}

export class DataSource {
  private cli: NpmCli
  private api: RegistryApi

  constructor() {
    this.cli = new NpmCli()
    this.api = new RegistryApi()
  }

  /**
   * 检测 CLI 是否可用
   */
  async isCliAvailable(): Promise<boolean> {
    return this.cli.isAvailable()
  }

  /**
   * 获取当前用户名
   */
  async getUsername(options: DataSourceOptions): Promise<string> {
    const { priority, registry } = options

    if (priority === 'cli-first') {
      try {
        return await this.cli.whoami({
          registry: registry.url,
          authToken: registry.authToken,
        })
      } catch {
        // CLI 失败，尝试 API
        return this.api.whoami({
          registry: registry.url,
          authToken: registry.authToken,
        })
      }
    }

    if (priority === 'api-first') {
      try {
        return await this.api.whoami({
          registry: registry.url,
          authToken: registry.authToken,
        })
      } catch {
        // API 失败，尝试 CLI
        return this.cli.whoami({
          registry: registry.url,
          authToken: registry.authToken,
        })
      }
    }

    // cache-only 不需要获取用户名
    throw new Error('cache-only 模式不支持获取用户名')
  }

  /**
   * 获取用户的包列表
   */
  async getUserPackages(
    username: string,
    options: DataSourceOptions,
  ): Promise<RemotePackage[]> {
    const { priority, registry } = options
    const registryId = registry.id

    if (priority === 'cli-first') {
      try {
        return await this.getPackagesViaCli(username, registry)
      } catch {
        return this.getPackagesViaApi(username, registry, registryId)
      }
    }

    if (priority === 'api-first') {
      try {
        return await this.getPackagesViaApi(username, registry, registryId)
      } catch {
        return this.getPackagesViaCli(username, registry)
      }
    }

    // cache-only
    return []
  }

  /**
   * 通过 CLI 获取包列表
   */
  private async getPackagesViaCli(
    username: string,
    registry: RegistryConfigInput,
  ): Promise<RemotePackage[]> {
    const cliOptions: NpmCliOptions = {
      registry: registry.url,
      authToken: registry.authToken,
    }

    const packageNames = await this.cli.listPackages(username, cliOptions)

    // 逐个获取包详情
    const packages: RemotePackage[] = []
    for (const name of packageNames) {
      try {
        const details = await this.cli.viewPackage(name, cliOptions)
        packages.push({
          name: details.name,
          version: details.version,
          description: details.description || '',
          license: details.license || '',
          homepage: details.homepage,
          repository: details.repository?.url,
          registryId: registry.id,
          maintainer: username,
          downloadsWeekly: 0, // CLI 不提供下载量
          downloadsMonthly: 0,
          updatedAt: details.time?.[details.version] || new Date().toISOString(),
          syncedAt: new Date().toISOString(),
        })
      } catch {
        // 获取详情失败，跳过
      }
    }

    return packages
  }

  /**
   * 通过 API 获取包列表
   */
  private async getPackagesViaApi(
    username: string,
    registry: RegistryConfigInput,
    registryId: string,
  ): Promise<RemotePackage[]> {
    const apiOptions: RegistryApiOptions = {
      registry: registry.url,
      authToken: registry.authToken,
    }

    const result = await this.api.searchByMaintainer(username, apiOptions)

    return result.objects.map(obj => ({
      name: obj.package.name,
      version: obj.package.version,
      description: obj.package.description || '',
      license: obj.package.license || '',
      homepage: obj.package.links?.homepage,
      repository: obj.package.links?.repository,
      registryId,
      maintainer: username,
      downloadsWeekly: 0, // npm search API 不提供下载量
      downloadsMonthly: 0,
      updatedAt: obj.package.date,
      syncedAt: new Date().toISOString(),
    }))
  }

  /**
   * 获取包详情
   */
  async getPackageDetails(
    packageName: string,
    options: DataSourceOptions,
  ): Promise<RemotePackage | null> {
    const { priority, registry } = options

    const tryApi = async (): Promise<RemotePackage | null> => {
      try {
        const details = await this.api.viewPackage(packageName, {
          registry: registry.url,
          authToken: registry.authToken,
        })

        return {
          name: details.name,
          version: details.version,
          description: details.description || '',
          license: details.license || '',
          homepage: details.homepage,
          repository: details.repository?.url,
          registryId: registry.id,
          maintainer: details.maintainers?.[0]?.name || '',
          downloadsWeekly: 0,
          downloadsMonthly: 0,
          updatedAt: details.time?.[details.version] || new Date().toISOString(),
          syncedAt: new Date().toISOString(),
        }
      } catch {
        return null
      }
    }

    const tryCli = async (): Promise<RemotePackage | null> => {
      try {
        const details = await this.cli.viewPackage(packageName, {
          registry: registry.url,
          authToken: registry.authToken,
        })

        return {
          name: details.name,
          version: details.version,
          description: details.description || '',
          license: details.license || '',
          homepage: details.homepage,
          repository: details.repository?.url,
          registryId: registry.id,
          maintainer: details.maintainers?.[0]?.name || '',
          downloadsWeekly: 0,
          downloadsMonthly: 0,
          updatedAt: details.time?.[details.version] || new Date().toISOString(),
          syncedAt: new Date().toISOString(),
        }
      } catch {
        return null
      }
    }

    if (priority === 'cli-first') {
      return (await tryCli()) || (await tryApi())
    }

    if (priority === 'api-first') {
      return (await tryApi()) || (await tryCli())
    }

    // cache-only
    return null
  }

  /**
   * 发布包
   */
  async publish(
    packagePath: string,
    options: DataSourceOptions & { tag?: string; otp?: string },
  ): Promise<void> {
    const { registry } = options

    // 发布只能通过 CLI
    await this.cli.publish(packagePath, {
      registry: registry.url,
      authToken: registry.authToken,
      tag: options.tag,
      otp: options.otp,
    })
  }

  /**
   * 创建 tarball
   */
  async pack(
    packagePath: string,
    options: DataSourceOptions,
  ): Promise<string> {
    const { registry } = options

    return this.cli.pack(packagePath, {
      registry: registry.url,
      authToken: registry.authToken,
    })
  }

  /**
   * 取消发布
   */
  async unpublish(
    packageName: string,
    version: string,
    options: DataSourceOptions,
  ): Promise<void> {
    const { registry } = options

    await this.cli.unpublish(packageName, version, {
      registry: registry.url,
      authToken: registry.authToken,
    })
  }
}
