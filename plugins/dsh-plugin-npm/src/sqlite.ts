// @ts-ignore - node:sqlite is available in Node.js 22+
import { DatabaseSync } from 'node:sqlite'
import { join } from 'path'
import { mkdirSync } from 'fs'
import type {
  RegistryConfig,
  RemotePackage,
  LocalPackage,
  SyncLog,
  PublishLog,
} from './types'

const SCHEMA = `
-- 注册源配置
CREATE TABLE IF NOT EXISTS registries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  scope TEXT,
  auth_token TEXT,
  is_default BOOLEAN DEFAULT 0,
  sync_enabled BOOLEAN DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 远端包缓存
CREATE TABLE IF NOT EXISTS remote_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  version TEXT,
  description TEXT,
  license TEXT,
  homepage TEXT,
  repository TEXT,
  registry_id TEXT NOT NULL,
  maintainer TEXT,
  downloads_weekly INTEGER DEFAULT 0,
  downloads_monthly INTEGER DEFAULT 0,
  updated_at TEXT,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_json TEXT,
  FOREIGN KEY (registry_id) REFERENCES registries(id) ON DELETE CASCADE,
  UNIQUE(name, registry_id)
);

-- 本地包（用户手动添加）
CREATE TABLE IF NOT EXISTS local_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  description TEXT,
  version TEXT,
  registry_id TEXT,
  status TEXT DEFAULT 'pending',
  validation_errors TEXT,
  last_validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (registry_id) REFERENCES registries(id) ON DELETE SET NULL
);

-- 同步记录
CREATE TABLE IF NOT EXISTS sync_logs (
  id TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,
  packages_count INTEGER,
  error_message TEXT,
  FOREIGN KEY (registry_id) REFERENCES registries(id) ON DELETE CASCADE
);

-- 发布记录
CREATE TABLE IF NOT EXISTS publish_logs (
  id TEXT PRIMARY KEY,
  local_package_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  version TEXT NOT NULL,
  registry_id TEXT NOT NULL,
  status TEXT,
  published_at TEXT NOT NULL,
  tarball_path TEXT,
  error_message TEXT,
  FOREIGN KEY (local_package_id) REFERENCES local_packages(id) ON DELETE CASCADE,
  FOREIGN KEY (registry_id) REFERENCES registries(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_remote_packages_registry ON remote_packages(registry_id);
CREATE INDEX IF NOT EXISTS idx_remote_packages_maintainer ON remote_packages(maintainer);
CREATE INDEX IF NOT EXISTS idx_local_packages_status ON local_packages(status);
CREATE INDEX IF NOT EXISTS idx_sync_logs_registry ON sync_logs(registry_id);
CREATE INDEX IF NOT EXISTS idx_publish_logs_local_package ON publish_logs(local_package_id);
`

export class NpmDatabase {
  private db: any

  constructor(dbPath: string) {
    // 确保目录存在
    const dir = join(dbPath, '..')
    mkdirSync(dir, { recursive: true })

    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')

    // 初始化 schema
    this.db.exec(SCHEMA)
  }

  close() {
    this.db.close()
  }

  // ========== Registry ==========

  getRegistries(): RegistryConfig[] {
    const rows = this.db.prepare('SELECT * FROM registries ORDER BY is_default DESC, name').all() as any[]
    return rows.map(this.mapRegistry)
  }

  getRegistry(id: string): RegistryConfig | undefined {
    const row = this.db.prepare('SELECT * FROM registries WHERE id = ?').get(id) as any
    return row ? this.mapRegistry(row) : undefined
  }

  getDefaultRegistry(): RegistryConfig | undefined {
    const row = this.db.prepare('SELECT * FROM registries WHERE is_default = 1').get() as any
    return row ? this.mapRegistry(row) : undefined
  }

  getRegistryByScope(scope: string): RegistryConfig | undefined {
    const row = this.db.prepare('SELECT * FROM registries WHERE scope = ?').get(scope) as any
    return row ? this.mapRegistry(row) : undefined
  }

  upsertRegistry(registry: RegistryConfig): void {
    const stmt = this.db.prepare(`
      INSERT INTO registries (id, name, url, scope, auth_token, is_default, sync_enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        url = excluded.url,
        scope = excluded.scope,
        auth_token = excluded.auth_token,
        is_default = excluded.is_default,
        sync_enabled = excluded.sync_enabled,
        updated_at = datetime('now')
    `)
    stmt.run(
      registry.id,
      registry.name,
      registry.url,
      registry.scope || null,
      registry.authToken || null,
      registry.isDefault ? 1 : 0,
      registry.syncEnabled ? 1 : 0,
    )
  }

  deleteRegistry(id: string): boolean {
    const result = this.db.prepare('DELETE FROM registries WHERE id = ?').run(id)
    return result.changes > 0
  }

  // ========== Remote Packages ==========

  getRemotePackages(registryId?: string): RemotePackage[] {
    let query = 'SELECT * FROM remote_packages'
    const params: any[] = []

    if (registryId) {
      query += ' WHERE registry_id = ?'
      params.push(registryId)
    }

    query += ' ORDER BY downloads_monthly DESC'

    const rows = this.db.prepare(query).all(...params) as any[]
    return rows.map(this.mapRemotePackage)
  }

  upsertRemotePackage(pkg: RemotePackage): void {
    const stmt = this.db.prepare(`
      INSERT INTO remote_packages (name, version, description, license, homepage, repository, registry_id, maintainer, downloads_weekly, downloads_monthly, updated_at, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name, registry_id) DO UPDATE SET
        version = excluded.version,
        description = excluded.description,
        license = excluded.license,
        homepage = excluded.homepage,
        repository = excluded.repository,
        maintainer = excluded.maintainer,
        downloads_weekly = excluded.downloads_weekly,
        downloads_monthly = excluded.downloads_monthly,
        updated_at = excluded.updated_at,
        synced_at = datetime('now')
    `)
    stmt.run(
      pkg.name,
      pkg.version,
      pkg.description,
      pkg.license,
      pkg.homepage || null,
      pkg.repository || null,
      pkg.registryId,
      pkg.maintainer,
      pkg.downloadsWeekly,
      pkg.downloadsMonthly,
      pkg.updatedAt || null,
    )
  }

  clearRemotePackages(registryId: string): void {
    this.db.prepare('DELETE FROM remote_packages WHERE registry_id = ?').run(registryId)
  }

  // ========== Local Packages ==========

  getLocalPackages(): LocalPackage[] {
    const rows = this.db.prepare('SELECT * FROM local_packages ORDER BY created_at DESC').all() as any[]
    return rows.map(this.mapLocalPackage)
  }

  getLocalPackage(id: string): LocalPackage | undefined {
    const row = this.db.prepare('SELECT * FROM local_packages WHERE id = ?').get(id) as any
    return row ? this.mapLocalPackage(row) : undefined
  }

  addLocalPackage(pkg: LocalPackage): void {
    const stmt = this.db.prepare(`
      INSERT INTO local_packages (id, name, path, description, version, registry_id, status, validation_errors, last_validated_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      pkg.id,
      pkg.name,
      pkg.path,
      pkg.description || null,
      pkg.version || null,
      pkg.registryId || null,
      pkg.status,
      JSON.stringify(pkg.validationErrors),
      pkg.lastValidatedAt || null,
      pkg.createdAt,
      pkg.updatedAt,
    )
  }

  updateLocalPackage(pkg: LocalPackage): void {
    const stmt = this.db.prepare(`
      UPDATE local_packages SET
        name = ?,
        path = ?,
        description = ?,
        version = ?,
        registry_id = ?,
        status = ?,
        validation_errors = ?,
        last_validated_at = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `)
    stmt.run(
      pkg.name,
      pkg.path,
      pkg.description || null,
      pkg.version || null,
      pkg.registryId || null,
      pkg.status,
      JSON.stringify(pkg.validationErrors),
      pkg.lastValidatedAt || null,
      pkg.id,
    )
  }

  deleteLocalPackage(id: string): boolean {
    const result = this.db.prepare('DELETE FROM local_packages WHERE id = ?').run(id)
    return result.changes > 0
  }

  // ========== Sync Logs ==========

  addSyncLog(log: SyncLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO sync_logs (id, registry_id, started_at, finished_at, status, packages_count, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      log.id,
      log.registryId,
      log.startedAt,
      log.finishedAt || null,
      log.status,
      log.packagesCount || null,
      log.errorMessage || null,
    )
  }

  updateSyncLog(log: SyncLog): void {
    const stmt = this.db.prepare(`
      UPDATE sync_logs SET
        finished_at = ?,
        status = ?,
        packages_count = ?,
        error_message = ?
      WHERE id = ?
    `)
    stmt.run(
      log.finishedAt || null,
      log.status,
      log.packagesCount || null,
      log.errorMessage || null,
      log.id,
    )
  }

  getSyncLogs(registryId?: string, limit = 20): SyncLog[] {
    let query = 'SELECT * FROM sync_logs'
    const params: any[] = []

    if (registryId) {
      query += ' WHERE registry_id = ?'
      params.push(registryId)
    }

    query += ' ORDER BY started_at DESC LIMIT ?'
    params.push(limit)

    const rows = this.db.prepare(query).all(...params) as any[]
    return rows.map(this.mapSyncLog)
  }

  // ========== Publish Logs ==========

  addPublishLog(log: PublishLog): void {
    const stmt = this.db.prepare(`
      INSERT INTO publish_logs (id, local_package_id, package_name, version, registry_id, status, published_at, tarball_path, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      log.id,
      log.localPackageId,
      log.packageName,
      log.version,
      log.registryId,
      log.status,
      log.publishedAt,
      log.tarballPath || null,
      log.errorMessage || null,
    )
  }

  getPublishLogs(localPackageId?: string, limit = 50): PublishLog[] {
    let query = 'SELECT * FROM publish_logs'
    const params: any[] = []

    if (localPackageId) {
      query += ' WHERE local_package_id = ?'
      params.push(localPackageId)
    }

    query += ' ORDER BY published_at DESC LIMIT ?'
    params.push(limit)

    const rows = this.db.prepare(query).all(...params) as any[]
    return rows.map(this.mapPublishLog)
  }

  // ========== Mappers ==========

  private mapRegistry(row: any): RegistryConfig {
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      scope: row.scope || undefined,
      authToken: row.auth_token || undefined,
      isDefault: Boolean(row.is_default),
      syncEnabled: Boolean(row.sync_enabled),
    }
  }

  private mapRemotePackage(row: any): RemotePackage {
    return {
      name: row.name,
      version: row.version,
      description: row.description,
      license: row.license,
      homepage: row.homepage || undefined,
      repository: row.repository || undefined,
      registryId: row.registry_id,
      maintainer: row.maintainer,
      downloadsWeekly: row.downloads_weekly,
      downloadsMonthly: row.downloads_monthly,
      updatedAt: row.updated_at,
      syncedAt: row.synced_at,
    }
  }

  private mapLocalPackage(row: any): LocalPackage {
    return {
      id: row.id,
      name: row.name,
      path: row.path,
      description: row.description || undefined,
      version: row.version || undefined,
      registryId: row.registry_id || undefined,
      status: row.status,
      validationErrors: row.validation_errors ? JSON.parse(row.validation_errors) : [],
      lastValidatedAt: row.last_validated_at || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapSyncLog(row: any): SyncLog {
    return {
      id: row.id,
      registryId: row.registry_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at || undefined,
      status: row.status,
      packagesCount: row.packages_count || undefined,
      errorMessage: row.error_message || undefined,
    }
  }

  private mapPublishLog(row: any): PublishLog {
    return {
      id: row.id,
      localPackageId: row.local_package_id,
      packageName: row.package_name,
      version: row.version,
      registryId: row.registry_id,
      status: row.status,
      publishedAt: row.published_at,
      tarballPath: row.tarball_path || undefined,
      errorMessage: row.error_message || undefined,
    }
  }
}
