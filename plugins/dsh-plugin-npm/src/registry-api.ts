import type { NpmSearchResult, NpmViewResult } from './types'

export interface RegistryApiOptions {
  registry?: string
  authToken?: string
  timeout?: number
}

export class RegistryApi {
  private defaultRegistry: string
  private defaultTimeout: number

  constructor(defaultRegistry = 'https://registry.npmjs.org/', defaultTimeout = 15000) {
    this.defaultRegistry = defaultRegistry
    this.defaultTimeout = defaultTimeout
  }

  /**
   * 获取当前登录用户名
   */
  async whoami(options: RegistryApiOptions = {}): Promise<string> {
    const registry = options.registry || this.defaultRegistry
    const url = `${registry.replace(/\/$/, '')}/-/whoami`

    const headers: Record<string, string> = {}
    if (options.authToken) {
      headers['Authorization'] = `Bearer ${options.authToken}`
    }

    const response = await this.fetch(url, { headers }, options.timeout)

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('未登录，请配置 authToken')
      }
      throw new Error(`whoami 失败: ${response.status}`)
    }

    const data = await response.json() as { username: string }
    return data.username
  }

  /**
   * 搜索包（按维护者）
   */
  async searchByMaintainer(
    username: string,
    options: RegistryApiOptions & { size?: number; from?: number } = {},
  ): Promise<NpmSearchResult> {
    const registry = options.registry || this.defaultRegistry
    const size = options.size || 250
    const from = options.from || 0
    const url = `${registry.replace(/\/$/, '')}/-/v1/search?text=maintainer:${encodeURIComponent(username)}&size=${size}&from=${from}`

    const headers: Record<string, string> = {}
    if (options.authToken) {
      headers['Authorization'] = `Bearer ${options.authToken}`
    }

    const response = await this.fetch(url, { headers }, options.timeout)

    if (!response.ok) {
      throw new Error(`搜索失败: ${response.status}`)
    }

    return response.json() as Promise<NpmSearchResult>
  }

  /**
   * 查看包详情
   */
  async viewPackage(
    packageName: string,
    options: RegistryApiOptions = {},
  ): Promise<NpmViewResult> {
    const registry = options.registry || this.defaultRegistry
    const url = `${registry.replace(/\/$/, '')}/${encodeURIComponent(packageName)}`

    const headers: Record<string, string> = {}
    if (options.authToken) {
      headers['Authorization'] = `Bearer ${options.authToken}`
    }

    const response = await this.fetch(url, { headers }, options.timeout)

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`包 ${packageName} 不存在`)
      }
      throw new Error(`查看包失败: ${response.status}`)
    }

    return response.json() as Promise<NpmViewResult>
  }

  /**
   * 搜索包
   */
  async search(
    query: string,
    options: RegistryApiOptions & { size?: number } = {},
  ): Promise<NpmSearchResult> {
    const registry = options.registry || this.defaultRegistry
    const size = options.size || 20
    const url = `${registry.replace(/\/$/, '')}/-/v1/search?text=${encodeURIComponent(query)}&size=${size}`

    const headers: Record<string, string> = {}
    if (options.authToken) {
      headers['Authorization'] = `Bearer ${options.authToken}`
    }

    const response = await this.fetch(url, { headers }, options.timeout)

    if (!response.ok) {
      throw new Error(`搜索失败: ${response.status}`)
    }

    return response.json() as Promise<NpmSearchResult>
  }

  /**
   * 封装 fetch 请求
   */
  private async fetch(
    url: string,
    init: RequestInit = {},
    timeout?: number,
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutMs = timeout || this.defaultTimeout
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      })
      return response
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`请求超时 (${timeoutMs}ms)`)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}
