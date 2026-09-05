import { randomUUID } from 'crypto'
import { NpmDatabase } from './sqlite'
import { SyncManager } from './sync'
import { PublishManager } from './publish'
import { validateLocalPackage } from './validator'
import type { NpmConfig, RegistryConfigInput } from './config'
import type { LocalPackage } from './types'

interface RouteContext {
  db: NpmDatabase
  syncManager: SyncManager
  publishManager: PublishManager
  config: NpmConfig
  logger: any
}

/**
 * 注册 Web API 路由
 */
export function registerRoutes(ctx: any, routeCtx: RouteContext) {
  const { db, syncManager, publishManager, config, logger } = routeCtx

  // ========== 远端包 ==========

  // 列出远端包
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/packages/remote',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const registryId = url.searchParams.get('registryId') || undefined
            const packages = db.getRemotePackages(registryId)
            res.writeHead(200)
            res.end(JSON.stringify({ packages }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: remote packages route',
    )
  })

  // 触发同步
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/sync',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const registryId = url.searchParams.get('registryId')

            if (registryId) {
              const registry = config.registries.find(r => r.id === registryId)
              if (!registry) {
                res.writeHead(404)
                res.end(JSON.stringify({ error: 'registry 不存在' }))
                return
              }
              const result = await syncManager.syncRegistry(registry)
              res.writeHead(200)
              res.end(JSON.stringify(result))
            } else {
              const results = await syncManager.syncAll()
              res.writeHead(200)
              res.end(JSON.stringify({ results }))
            }
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: sync route',
    )
  })

  // ========== 本地包 ==========

  // 列出本地包
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/packages/local',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const packages = db.getLocalPackages()
            res.writeHead(200)
            res.end(JSON.stringify({ packages }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: local packages route',
    )
  })

  // 添加本地包
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/packages/local/add',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const body = await readBody(req)
            const { path: packagePath, registryId } = JSON.parse(body)

            if (!packagePath) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: '缺少 path 参数' }))
              return
            }

            // 验证包
            const validation = await validateLocalPackage(packagePath)
            if (!validation.valid) {
              res.writeHead(400)
              res.end(JSON.stringify({
                error: '包验证失败',
                validation,
              }))
              return
            }

            // 检查是否已存在
            const existing = db.getLocalPackages().find(p => p.path === packagePath)
            if (existing) {
              res.writeHead(409)
              res.end(JSON.stringify({ error: '包已存在', package: existing }))
              return
            }

            const localPkg: LocalPackage = {
              id: randomUUID(),
              name: validation.metadata?.name || 'unknown',
              path: packagePath,
              description: validation.metadata?.description,
              version: validation.metadata?.version,
              registryId: registryId || undefined,
              status: validation.valid ? 'valid' : 'invalid',
              validationErrors: validation.errors,
              lastValidatedAt: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }

            db.addLocalPackage(localPkg)

            res.writeHead(201)
            res.end(JSON.stringify({ package: localPkg, validation }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: add local package route',
    )
  })

  // 更新本地包
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/packages/local/update',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const body = await readBody(req)
            const { id, registryId } = JSON.parse(body)

            if (!id) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: '缺少 id 参数' }))
              return
            }

            const localPkg = db.getLocalPackage(id)
            if (!localPkg) {
              res.writeHead(404)
              res.end(JSON.stringify({ error: '包不存在' }))
              return
            }

            if (registryId !== undefined) {
              localPkg.registryId = registryId
            }

            localPkg.updatedAt = new Date().toISOString()
            db.updateLocalPackage(localPkg)

            res.writeHead(200)
            res.end(JSON.stringify({ package: localPkg }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: update local package route',
    )
  })

  // 删除本地包
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/packages/local/delete',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const id = url.searchParams.get('id')

            if (!id) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: '缺少 id 参数' }))
              return
            }

            const deleted = db.deleteLocalPackage(id)
            if (!deleted) {
              res.writeHead(404)
              res.end(JSON.stringify({ error: '包不存在' }))
              return
            }

            res.writeHead(200)
            res.end(JSON.stringify({ success: true }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: delete local package route',
    )
  })

  // 验证本地包
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/packages/local/validate',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const id = url.searchParams.get('id')

            if (!id) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: '缺少 id 参数' }))
              return
            }

            const localPkg = db.getLocalPackage(id)
            if (!localPkg) {
              res.writeHead(404)
              res.end(JSON.stringify({ error: '包不存在' }))
              return
            }

            const validation = await validateLocalPackage(localPkg.path)

            // 更新本地包状态
            localPkg.status = validation.valid ? 'valid' : 'invalid'
            localPkg.validationErrors = validation.errors
            localPkg.lastValidatedAt = new Date().toISOString()
            if (validation.metadata) {
              localPkg.name = validation.metadata.name
              localPkg.description = validation.metadata.description
              localPkg.version = validation.metadata.version
            }
            db.updateLocalPackage(localPkg)

            res.writeHead(200)
            res.end(JSON.stringify({ package: localPkg, validation }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: validate local package route',
    )
  })

  // 发布本地包
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/packages/local/publish',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const body = await readBody(req)
            const { id, tag, otp, dryRun } = JSON.parse(body)

            if (!id) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: '缺少 id 参数' }))
              return
            }

            const result = await publishManager.publish({
              localPackageId: id,
              tag,
              otp,
              dryRun,
            })

            res.writeHead(result.success ? 200 : 400)
            res.end(JSON.stringify(result))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: publish local package route',
    )
  })

  // ========== Registry ==========

  // 列出 registry
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/registries',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const registries = db.getRegistries()
            res.writeHead(200)
            res.end(JSON.stringify({ registries }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: registries route',
    )
  })

  // 添加/更新 registry
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/registries/save',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const body = await readBody(req)
            const registry = JSON.parse(body) as RegistryConfigInput

            if (!registry.id || !registry.name || !registry.url) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: '缺少必填字段' }))
              return
            }

            db.upsertRegistry(registry)

            res.writeHead(200)
            res.end(JSON.stringify({ success: true, registry }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: save registry route',
    )
  })

  // 删除 registry
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/registries/delete',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const id = url.searchParams.get('id')

            if (!id) {
              res.writeHead(400)
              res.end(JSON.stringify({ error: '缺少 id 参数' }))
              return
            }

            const deleted = db.deleteRegistry(id)
            if (!deleted) {
              res.writeHead(404)
              res.end(JSON.stringify({ error: 'registry 不存在' }))
              return
            }

            res.writeHead(200)
            res.end(JSON.stringify({ success: true }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: delete registry route',
    )
  })

  // ========== 发布记录 ==========

  // 列出发布记录
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/publish-logs',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const localPackageId = url.searchParams.get('localPackageId') || undefined
            const limit = parseInt(url.searchParams.get('limit') || '50')
            const logs = db.getPublishLogs(localPackageId, limit)
            res.writeHead(200)
            res.end(JSON.stringify({ logs }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: publish logs route',
    )
  })

  // ========== 同步记录 ==========

  // 列出同步记录
  ctx.inject(['webServer'], (wsCtx: any) => {
    wsCtx.effect(() =>
      wsCtx.webServer.register({
        kind: 'exact',
        path: '/plugins/dsh-plugin-npm/sync-logs',
        handler: async (req: any, res: any) => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const url = new URL(req.url ?? '/', 'http://localhost')
            const registryId = url.searchParams.get('registryId') || undefined
            const limit = parseInt(url.searchParams.get('limit') || '20')
            const logs = db.getSyncLogs(registryId, limit)
            res.writeHead(200)
            res.end(JSON.stringify({ logs }))
          } catch (error: any) {
            res.writeHead(500)
            res.end(JSON.stringify({ error: error.message }))
          }
        },
      }),
      'dsh-plugin-npm: sync logs route',
    )
  })
}

/**
 * 读取请求体
 */
function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}
