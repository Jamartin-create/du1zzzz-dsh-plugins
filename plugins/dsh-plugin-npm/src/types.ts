/** 注册源配置 */
export interface RegistryConfig {
  id: string
  name: string
  url: string
  scope?: string
  authToken?: string
  isDefault: boolean
  syncEnabled: boolean
}

/** 包信息（远端） */
export interface RemotePackage {
  name: string
  version: string
  description: string
  license: string
  homepage?: string
  repository?: string
  registryId: string
  maintainer: string
  downloadsWeekly: number
  downloadsMonthly: number
  updatedAt: string
  syncedAt: string
}

/** 本地包（用户手动添加） */
export interface LocalPackage {
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

/** 同步记录 */
export interface SyncLog {
  id: string
  registryId: string
  startedAt: string
  finishedAt?: string
  status: 'success' | 'error'
  packagesCount?: number
  errorMessage?: string
}

/** 发布记录 */
export interface PublishLog {
  id: string
  localPackageId: string
  packageName: string
  version: string
  registryId: string
  status: 'success' | 'error'
  publishedAt: string
  tarballPath?: string
  errorMessage?: string
}

/** 验证结果 */
export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  metadata?: PackageMetadata
}

/** 包元数据 */
export interface PackageMetadata {
  name: string
  version: string
  description?: string
  main?: string
  types?: string
  files?: string[]
  license?: string
  repository?: string
  homepage?: string
}

/** 同步策略 */
export interface SyncStrategy {
  autoSync: {
    enabled: boolean
    intervalMs: number
  }
  sourcePriority: 'cli-first' | 'api-first' | 'cache-only'
}

/** npm search API 响应 */
export interface NpmSearchResult {
  objects: Array<{
    package: {
      name: string
      version: string
      description: string
      publisher: { username: string; email: string }
      maintainers: Array<{ username: string; email: string }>
      license: string
      date: string
      links: {
        homepage?: string
        repository?: string
        bugs?: string
        npm?: string
      }
    }
    // 注意：npm 的 /-/v1/search 响应不包含下载量字段
  }>
  total: number
  time: string
}

/** npm view API 响应 */
export interface NpmViewResult {
  name: string
  version: string
  description?: string
  license?: string
  homepage?: string
  repository?: { type: string; url: string }
  main?: string
  types?: string
  files?: string[]
  maintainers?: Array<{ name: string; email: string }>
  time?: Record<string, string>
  dist?: { tarball: string }
}
