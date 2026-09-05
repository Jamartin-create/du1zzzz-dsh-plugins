import z from "@deepseek-ai/schemastery"

/** Registry 配置（存储于 sqlite registries 表，见 sqlite.ts） */
export interface RegistryConfigInput {
  id: string
  name: string
  url: string
  scope?: string
  authToken?: string
  isDefault: boolean
  syncEnabled: boolean
}

/** 自动同步配置 */
export interface AutoSyncConfig {
  enabled: boolean
  intervalMs: number
}

/** 插件配置（registries 不在此处——唯一的真实来源是 sqlite registries 表） */
export interface NpmConfig {
  autoSync: AutoSyncConfig
  sourcePriority: 'cli-first' | 'api-first' | 'cache-only'
  defaultPublishTag: string
}

/** 自动同步 schema */
const AutoSyncSchema = z.object({
  enabled: z.boolean().default(true),
  intervalMs: z.natural().default(1_800_000), // 30 分钟
})

/** Settings-namespace schema */
export const SettingsSchema: any = z.object({
  autoSync: AutoSyncSchema.default({
    enabled: true,
    intervalMs: 1_800_000,
  }),
  sourcePriority: z.union([
    z.const('cli-first'),
    z.const('api-first'),
    z.const('cache-only'),
  ]).default('cli-first'),
  defaultPublishTag: z.string().default('latest'),
})

/** 默认配置 */
export const DEFAULT_CONFIG: NpmConfig = {
  autoSync: {
    enabled: true,
    intervalMs: 1_800_000,
  },
  sourcePriority: 'cli-first',
  defaultPublishTag: 'latest',
}

/** 首次启动时写入数据库的默认 registry */
export const DEFAULT_REGISTRY: RegistryConfigInput = {
  id: 'npmjs',
  name: 'npmjs',
  url: 'https://registry.npmjs.org/',
  isDefault: true,
  syncEnabled: true,
}
