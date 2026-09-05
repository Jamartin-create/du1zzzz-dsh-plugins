import { defineTool } from '@deepseek-ai/dsh-tools'
import { NpmDatabase } from './sqlite'
import { DataSource } from './data-source'
import { SyncManager } from './sync'
import { PublishManager } from './publish'
import { validateLocalPackage } from './validator'
import type { NpmConfig } from './config'
import type { RegistryConfig } from './types'

interface ToolContext {
  db: NpmDatabase
  dataSource: DataSource
  syncManager: SyncManager
  publishManager: PublishManager
  getConfig: () => NpmConfig
}

/** 按名称或 id 查找 registry（唯一真实来源是 sqlite registries 表） */
function findRegistry(db: NpmDatabase, nameOrId: string): RegistryConfig | undefined {
  return db.getRegistries().find(r => r.name === nameOrId || r.id === nameOrId)
}

function textBlock(text: string) {
  return [{ type: 'text' as const, text }]
}

/**
 * 注册 Agent 工具
 */
export function registerTools(ctx: any, toolCtx: ToolContext) {
  const { db, dataSource, syncManager, publishManager, getConfig } = toolCtx

  // npm_list_packages
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register(
        defineTool({
          name: 'npm_list_packages',
          description: '列出当前用户的 npm 包列表。支持指定 registry 和强制刷新。',
          parameters: {
            registry: {
              type: 'string',
              description: '指定 registry 名称或 id（可选，默认使用所有已配置的 registry）',
            },
            refresh: {
              type: 'boolean',
              description: '是否强制刷新（从远端重新获取，默认 false）',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ok: { type: 'boolean', required: true },
                error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                total: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
                packages: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: true },
                },
              },
            },
            render: (_args: any, value: any) =>
              textBlock(
                value.ok
                  ? `共 ${value.total} 个包：\n` +
                      (value.packages as any[])
                        .map(p => `- ${p.name}@${p.version}${p.description ? ` — ${p.description}` : ''}`)
                        .join('\n')
                  : `获取包列表失败: ${value.error}`,
              ),
          },
          async execute(args: any) {
            const { registry: registryName, refresh } = args

            try {
              // 如果需要刷新
              if (refresh) {
                if (registryName) {
                  const registry = findRegistry(db, registryName)
                  if (!registry) {
                    return { ok: false, error: `registry "${registryName}" 不存在`, total: null, packages: [] }
                  }
                  const result = await syncManager.syncRegistry(registry)
                  if (!result.success) {
                    return { ok: false, error: `同步失败: ${result.error}`, total: null, packages: [] }
                  }
                } else {
                  await syncManager.syncAll()
                }
              }

              // 从数据库获取
              const registryId = registryName
                ? findRegistry(db, registryName)?.id
                : undefined

              const packages = db.getRemotePackages(registryId)

              return {
                ok: true,
                error: null,
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
              return { ok: false, error: String(error.message), total: null, packages: [] }
            }
          },
          presentCall() {
            return { card: 'generic', title: 'npm list packages', kind: 'execute' }
          },
        }),
      ),
      'dsh-plugin-npm: npm_list_packages tool',
    )
  })

  // npm_view_package
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register(
        defineTool({
          name: 'npm_view_package',
          description: '查看 npm 包详情',
          parameters: {
            name: {
              type: 'string',
              required: true,
              description: '包名',
            },
            registry: {
              type: 'string',
              description: '指定 registry 名称或 id（可选）',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ok: { type: 'boolean', required: true },
                error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                package: {
                  oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
                },
              },
            },
            render: (_args: any, value: any) =>
              textBlock(
                value.ok
                  ? `${value.package.name}@${value.package.version}\n` +
                      `${value.package.description || ''}\n` +
                      `license: ${value.package.license || '-'}\n` +
                      `homepage: ${value.package.homepage || '-'}\n` +
                      `repository: ${value.package.repository || '-'}`
                  : `查看包失败: ${value.error}`,
              ),
          },
          async execute(args: any) {
            const config = getConfig()
            const { name, registry: registryName } = args

            try {
              const registry = registryName
                ? findRegistry(db, registryName)
                : db.getDefaultRegistry()

              if (!registry) {
                return { ok: false, error: '找不到对应的 registry', package: null }
              }

              const pkg = await dataSource.getPackageDetails(name, {
                priority: config.sourcePriority,
                registry,
              })

              if (!pkg) {
                return { ok: false, error: `包 "${name}" 不存在`, package: null }
              }

              return {
                ok: true,
                error: null,
                package: {
                  name: pkg.name,
                  version: pkg.version,
                  description: pkg.description,
                  license: pkg.license,
                  homepage: pkg.homepage ?? null,
                  repository: pkg.repository ?? null,
                  maintainer: pkg.maintainer,
                  downloadsWeekly: pkg.downloadsWeekly,
                  downloadsMonthly: pkg.downloadsMonthly,
                  updatedAt: pkg.updatedAt,
                },
              }
            } catch (error: any) {
              return { ok: false, error: String(error.message), package: null }
            }
          },
          presentCall(args: any) {
            return { card: 'generic', title: `npm view ${args.name}`, kind: 'execute' }
          },
        }),
      ),
      'dsh-plugin-npm: npm_view_package tool',
    )
  })

  // npm_validate_package
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register(
        defineTool({
          name: 'npm_validate_package',
          description: '验证本地包是否符合发布要求',
          parameters: {
            path: {
              type: 'string',
              required: true,
              description: '本地包路径',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                valid: { type: 'boolean', required: true },
                errors: { type: 'array', items: { type: 'string' }, required: true },
                warnings: { type: 'array', items: { type: 'string' }, required: true },
                metadata: {
                  oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
                },
                error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
            render: (_args: any, value: any) =>
              textBlock(
                value.error
                  ? `验证失败: ${value.error}`
                  : value.valid
                    ? `验证通过${value.warnings.length ? `\n警告:\n${value.warnings.map((w: string) => `- ${w}`).join('\n')}` : ''}`
                    : `验证未通过:\n${value.errors.map((e: string) => `- ${e}`).join('\n')}`,
              ),
          },
          async execute(args: any) {
            try {
              const result = await validateLocalPackage(args.path)
              return {
                valid: result.valid,
                errors: result.errors,
                warnings: result.warnings,
                metadata: (result.metadata ?? null) as any,
                error: null,
              }
            } catch (error: any) {
              return {
                valid: false,
                errors: [String(error.message)],
                warnings: [],
                metadata: null,
                error: String(error.message),
              }
            }
          },
          presentCall(args: any) {
            return { card: 'generic', title: `npm validate ${args.path}`, kind: 'execute' }
          },
        }),
      ),
      'dsh-plugin-npm: npm_validate_package tool',
    )
  })

  // npm_publish
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register(
        defineTool({
          name: 'npm_publish',
          description: '发布 npm 包。需要先通过 npm_add_local_package 添加本地包。',
          parameters: {
            localPackageId: {
              type: 'string',
              required: true,
              description: '本地包 ID（通过 npm_add_local_package 添加后获得）',
            },
            tag: {
              type: 'string',
              description: '发布 tag（默认使用配置的 defaultPublishTag）',
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
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                success: { type: 'boolean', required: true },
                packageName: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                version: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                registryId: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
            },
            render: (_args: any, value: any) =>
              textBlock(
                value.success
                  ? `发布成功: ${value.packageName}@${value.version} (registry: ${value.registryId})`
                  : `发布失败: ${value.error}`,
              ),
          },
          async execute(args: any) {
            try {
              const result = await publishManager.publish({
                localPackageId: args.localPackageId,
                tag: args.tag,
                otp: args.otp,
                dryRun: args.dryRun,
              })
              return {
                success: result.success,
                packageName: result.packageName ?? null,
                version: result.version ?? null,
                registryId: result.registryId ?? null,
                error: result.error ?? null,
              }
            } catch (error: any) {
              return {
                success: false,
                packageName: null,
                version: null,
                registryId: null,
                error: String(error.message),
              }
            }
          },
          presentCall(args: any) {
            return { card: 'generic', title: `npm publish ${args.localPackageId}`, kind: 'execute' }
          },
        }),
      ),
      'dsh-plugin-npm: npm_publish tool',
    )
  })

  // npm_add_local_package
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register(
        defineTool({
          name: 'npm_add_local_package',
          description: '添加本地包到管理列表。会自动验证包是否符合发布要求。',
          parameters: {
            path: {
              type: 'string',
              required: true,
              description: '本地包路径',
            },
            registryId: {
              type: 'string',
              description: '关联的 registry ID（可选）',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                success: { type: 'boolean', required: true },
                error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                package: {
                  oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
                },
                validation: {
                  oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
                },
              },
            },
            render: (_args: any, value: any) =>
              textBlock(
                value.success
                  ? `已添加本地包 ${value.package.name}@${value.package.version ?? '?'} (id: ${value.package.id})`
                  : `添加本地包失败: ${value.error}`,
              ),
          },
          async execute(args: any) {
            try {
              const { path: packagePath, registryId } = args

              // 验证包
              const validation = await validateLocalPackage(packagePath)
              if (!validation.valid) {
                return {
                  success: false,
                  error: `包验证失败: ${validation.errors.join(', ')}`,
                  package: null,
                  validation: validation as any,
                }
              }

              // 检查是否已存在
              const existing = db.getLocalPackages().find(p => p.path === packagePath)
              if (existing) {
                return {
                  success: false,
                  error: '包已存在',
                  package: existing as any,
                  validation: validation as any,
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
                error: null,
                package: localPkg as any,
                validation: validation as any,
              }
            } catch (error: any) {
              return { success: false, error: String(error.message), package: null, validation: null }
            }
          },
          presentCall(args: any) {
            return { card: 'generic', title: `npm add local package ${args.path}`, kind: 'execute' }
          },
        }),
      ),
      'dsh-plugin-npm: npm_add_local_package tool',
    )
  })

  // npm_list_local_packages
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register(
        defineTool({
          name: 'npm_list_local_packages',
          description: '列出已添加的本地包',
          parameters: {},
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ok: { type: 'boolean', required: true },
                error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                total: { oneOf: [{ type: 'integer' }, { type: 'null' }] },
                packages: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: true },
                },
              },
            },
            render: (_args: any, value: any) =>
              textBlock(
                value.ok
                  ? `共 ${value.total} 个本地包：\n` +
                      (value.packages as any[])
                        .map(p => `- ${p.name}@${p.version ?? '?'} [${p.status}] ${p.path} (id: ${p.id})`)
                        .join('\n')
                  : `获取本地包列表失败: ${value.error}`,
              ),
          },
          async execute() {
            try {
              const packages = db.getLocalPackages()
              return {
                ok: true,
                error: null,
                total: packages.length,
                packages: packages.map(pkg => ({
                  id: pkg.id,
                  name: pkg.name,
                  path: pkg.path,
                  version: pkg.version ?? null,
                  status: pkg.status,
                  registryId: pkg.registryId ?? null,
                })),
              }
            } catch (error: any) {
              return { ok: false, error: String(error.message), total: null, packages: [] }
            }
          },
          presentCall() {
            return { card: 'generic', title: 'npm list local packages', kind: 'execute' }
          },
        }),
      ),
      'dsh-plugin-npm: npm_list_local_packages tool',
    )
  })

  // npm_sync
  ctx.inject(['tools'], (toolsCtx: any) => {
    toolsCtx.effect(() =>
      toolsCtx.tools.register(
        defineTool({
          name: 'npm_sync',
          description: '同步 npm 包列表到本地缓存',
          parameters: {
            registry: {
              type: 'string',
              description: '指定 registry 名称或 id（可选，默认同步所有）',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ok: { type: 'boolean', required: true },
                error: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                results: {
                  type: 'array',
                  items: { type: 'object', additionalProperties: true },
                },
              },
            },
            render: (_args: any, value: any) =>
              textBlock(
                value.ok
                  ? `同步完成：\n` +
                      (value.results as any[])
                        .map(r => `- ${r.registryId}: ${r.success ? `${r.packagesCount} 个包` : `失败 (${r.error})`}`)
                        .join('\n')
                  : `同步失败: ${value.error}`,
              ),
          },
          async execute(args: any) {
            const { registry: registryName } = args

            try {
              if (registryName) {
                const registry = findRegistry(db, registryName)
                if (!registry) {
                  return { ok: false, error: `registry "${registryName}" 不存在`, results: [] }
                }
                const result = await syncManager.syncRegistry(registry)
                return { ok: result.success, error: result.error ?? null, results: [result as any] }
              } else {
                const results = await syncManager.syncAll()
                return {
                  ok: results.every(r => r.success),
                  error: null,
                  results: results as any[],
                }
              }
            } catch (error: any) {
              return { ok: false, error: String(error.message), results: [] }
            }
          },
          presentCall(args: any) {
            return { card: 'generic', title: `npm sync${args.registry ? ` ${args.registry}` : ''}`, kind: 'execute' }
          },
        }),
      ),
      'dsh-plugin-npm: npm_sync tool',
    )
  })
}
