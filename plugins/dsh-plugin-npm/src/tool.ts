import { NpmDatabase } from './sqlite'
import { DataSource } from './data-source'
import { SyncManager } from './sync'
import { PublishManager } from './publish'
import { validateLocalPackage } from './validator'
import type { NpmConfig } from './config'

interface ToolContext {
  db: NpmDatabase
  dataSource: DataSource
  syncManager: SyncManager
  publishManager: PublishManager
  getConfig: () => NpmConfig
}

/**
 * 注册 Agent 工具
 */
export function registerTools(ctx: any, toolCtx: ToolContext) {
  const { db, dataSource, syncManager, publishManager, getConfig } = toolCtx

  // npm_list_packages
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register({
        name: 'npm_list_packages',
        description: '列出当前用户的 npm 包列表。支持指定 registry 和强制刷新。',
        parameters: {
          type: 'object',
          properties: {
            registry: {
              type: 'string',
              description: '指定 registry 名称（可选，默认使用所有已配置的 registry）',
            },
            refresh: {
              type: 'boolean',
              description: '是否强制刷新（从远端重新获取，默认 false）',
            },
          },
        },
        async execute(params: { registry?: string; refresh?: boolean }) {
          const config = getConfig()
          const { registry: registryName, refresh } = params

          try {
            // 如果需要刷新
            if (refresh) {
              if (registryName) {
                const registry = config.registries.find(r => r.name === registryName)
                if (!registry) {
                  return { error: `registry "${registryName}" 不存在` }
                }
                const result = await syncManager.syncRegistry(registry)
                if (!result.success) {
                  return { error: `同步失败: ${result.error}` }
                }
              } else {
                await syncManager.syncAll()
              }
            }

            // 从数据库获取
            const registryId = registryName
              ? config.registries.find(r => r.name === registryName)?.id
              : undefined

            const packages = db.getRemotePackages(registryId)

            return {
              total: packages.length,
              packages: packages.map(pkg => ({
                name: pkg.name,
                version: pkg.version,
                description: pkg.description,
                license: pkg.license,
                downloadsMonthly: pkg.downloadsMonthly,
                updatedAt: pkg.updatedAt,
              })),
            }
          } catch (error: any) {
            return { error: error.message }
          }
        },
      }),
      'dsh-plugin-npm: npm_list_packages tool',
    )
  })

  // npm_view_package
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register({
        name: 'npm_view_package',
        description: '查看 npm 包详情',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: '包名',
            },
            registry: {
              type: 'string',
              description: '指定 registry 名称（可选）',
            },
          },
          required: ['name'],
        },
        async execute(params: { name: string; registry?: string }) {
          const config = getConfig()
          const { name, registry: registryName } = params

          try {
            const registry = registryName
              ? config.registries.find(r => r.name === registryName)
              : config.registries.find(r => r.isDefault)

            if (!registry) {
              return { error: '找不到对应的 registry' }
            }

            const pkg = await dataSource.getPackageDetails(name, {
              priority: config.sourcePriority,
              registry,
            })

            if (!pkg) {
              return { error: `包 "${name}" 不存在` }
            }

            return {
              name: pkg.name,
              version: pkg.version,
              description: pkg.description,
              license: pkg.license,
              homepage: pkg.homepage,
              repository: pkg.repository,
              maintainer: pkg.maintainer,
              downloadsWeekly: pkg.downloadsWeekly,
              downloadsMonthly: pkg.downloadsMonthly,
              updatedAt: pkg.updatedAt,
            }
          } catch (error: any) {
            return { error: error.message }
          }
        },
      }),
      'dsh-plugin-npm: npm_view_package tool',
    )
  })

  // npm_validate_package
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register({
        name: 'npm_validate_package',
        description: '验证本地包是否符合发布要求',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '本地包路径',
            },
          },
          required: ['path'],
        },
        async execute(params: { path: string }) {
          try {
            const result = await validateLocalPackage(params.path)
            return result
          } catch (error: any) {
            return { error: error.message }
          }
        },
      }),
      'dsh-plugin-npm: npm_validate_package tool',
    )
  })

  // npm_publish
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register({
        name: 'npm_publish',
        description: '发布 npm 包。需要先通过 npm_add_local_package 添加本地包。',
        parameters: {
          type: 'object',
          properties: {
            localPackageId: {
              type: 'string',
              description: '本地包 ID（通过 npm_add_local_package 添加后获得）',
            },
            tag: {
              type: 'string',
              description: '发布 tag（默认 latest）',
            },
            otp: {
              type: 'string',
              description: 'OTP 验证码（如需要）',
            },
            dryRun: {
              type: 'boolean',
              description: '是否为 dry-run（不实际发布）',
            },
          },
          required: ['localPackageId'],
        },
        async execute(params: {
          localPackageId: string
          tag?: string
          otp?: string
          dryRun?: boolean
        }) {
          try {
            const result = await publishManager.publish(params)
            return result
          } catch (error: any) {
            return { error: error.message }
          }
        },
      }),
      'dsh-plugin-npm: npm_publish tool',
    )
  })

  // npm_add_local_package
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register({
        name: 'npm_add_local_package',
        description: '添加本地包到管理列表。会自动验证包是否符合发布要求。',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: '本地包路径',
            },
            registryId: {
              type: 'string',
              description: '关联的 registry ID（可选）',
            },
          },
          required: ['path'],
        },
        async execute(params: { path: string; registryId?: string }) {
          try {
            const { path: packagePath, registryId } = params

            // 验证包
            const validation = await validateLocalPackage(packagePath)
            if (!validation.valid) {
              return {
                error: '包验证失败',
                validation,
              }
            }

            // 检查是否已存在
            const existing = db.getLocalPackages().find(p => p.path === packagePath)
            if (existing) {
              return {
                error: '包已存在',
                package: existing,
              }
            }

            const { randomUUID } = await import('crypto')
            const localPkg = {
              id: randomUUID(),
              name: validation.metadata?.name || 'unknown',
              path: packagePath,
              description: validation.metadata?.description,
              version: validation.metadata?.version,
              registryId: registryId || undefined,
              status: validation.valid ? 'valid' as const : 'invalid' as const,
              validationErrors: validation.errors,
              lastValidatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }

            db.addLocalPackage(localPkg)

            return {
              success: true,
              package: localPkg,
              validation,
            }
          } catch (error: any) {
            return { error: error.message }
          }
        },
      }),
      'dsh-plugin-npm: npm_add_local_package tool',
    )
  })

  // npm_list_local_packages
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register({
        name: 'npm_list_local_packages',
        description: '列出已添加的本地包',
        parameters: {
          type: 'object',
          properties: {},
        },
        async execute() {
          try {
            const packages = db.getLocalPackages()
            return {
              total: packages.length,
              packages: packages.map(pkg => ({
                id: pkg.id,
                name: pkg.name,
                path: pkg.path,
                version: pkg.version,
                status: pkg.status,
                registryId: pkg.registryId,
              })),
            }
          } catch (error: any) {
            return { error: error.message }
          }
        },
      }),
      'dsh-plugin-npm: npm_list_local_packages tool',
    )
  })

  // npm_sync
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register({
        name: 'npm_sync',
        description: '同步 npm 包列表到本地缓存',
        parameters: {
          type: 'object',
          properties: {
            registry: {
              type: 'string',
              description: '指定 registry 名称（可选，默认同步所有）',
            },
          },
        },
        async execute(params: { registry?: string }) {
          const config = getConfig()
          const { registry: registryName } = params

          try {
            if (registryName) {
              const registry = config.registries.find(r => r.name === registryName)
              if (!registry) {
                return { error: `registry "${registryName}" 不存在` }
              }
              const result = await syncManager.syncRegistry(registry)
              return result
            } else {
              const results = await syncManager.syncAll()
              return { results }
            }
          } catch (error: any) {
            return { error: error.message }
          }
        },
      }),
      'dsh-plugin-npm: npm_sync tool',
    )
  })
}
