import { execFile } from 'child_process'
import { promisify } from 'util'
import type { NpmViewResult } from './types'

const execFileAsync = promisify(execFile)

export interface NpmCliOptions {
  registry?: string
  cwd?: string
  authToken?: string
}

export class NpmCli {
  private npmPath: string

  constructor(npmPath = 'npm') {
    this.npmPath = npmPath
  }

  /**
   * 检测 npm CLI 是否可用
   */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.npmPath, ['--version'], { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * 获取 npm 版本
   */
  async getVersion(): Promise<string> {
    const { stdout } = await execFileAsync(this.npmPath, ['--version'], { timeout: 5000 })
    return stdout.trim()
  }

  /**
   * 获取当前登录用户名
   */
  async whoami(options: NpmCliOptions = {}): Promise<string> {
    const args = ['whoami']
    if (options.registry) {
      args.push('--registry', options.registry)
    }

    const env = this.buildEnv(options)

    try {
      const { stdout } = await execFileAsync(this.npmPath, args, {
        timeout: 10000,
        env,
        cwd: options.cwd,
      })
      return stdout.trim()
    } catch (error: any) {
      if (error.stderr?.includes('ENEEDAUTH')) {
        throw new Error('未登录，请先运行 npm adduser 或配置 authToken')
      }
      throw error
    }
  }

  /**
   * 获取当前用户的包列表
   */
  async listPackages(user?: string, options: NpmCliOptions = {}): Promise<string[]> {
    const args = ['access', 'list', 'packages']
    if (user) {
      args.push(user)
    }
    if (options.registry) {
      args.push('--registry', options.registry)
    }

    const env = this.buildEnv(options)

    try {
      const { stdout } = await execFileAsync(this.npmPath, args, {
        timeout: 15000,
        env,
        cwd: options.cwd,
      })

      // 解析输出，格式为 "package-name: read-write" 或 JSON
      const lines = stdout.trim().split('\n').filter(Boolean)
      return lines.map(line => {
        const parts = line.split(':')
        return parts[0].trim()
      })
    } catch (error: any) {
      if (error.stderr?.includes('ENEEDAUTH')) {
        throw new Error('未登录，请先运行 npm adduser 或配置 authToken')
      }
      throw error
    }
  }

  /**
   * 查看包详情
   */
  async viewPackage(packageName: string, options: NpmCliOptions = {}): Promise<NpmViewResult> {
    const args = ['view', packageName, '--json']
    if (options.registry) {
      args.push('--registry', options.registry)
    }

    const env = this.buildEnv(options)

    const { stdout } = await execFileAsync(this.npmPath, args, {
      timeout: 15000,
      env,
      cwd: options.cwd,
    })

    return JSON.parse(stdout)
  }

  /**
   * 创建 tarball
   */
  async pack(packagePath: string, options: NpmCliOptions = {}): Promise<string> {
    const args = ['pack']
    if (options.registry) {
      args.push('--registry', options.registry)
    }

    const env = this.buildEnv(options)

    const { stdout } = await execFileAsync(this.npmPath, args, {
      timeout: 60000,
      cwd: packagePath,
      env,
    })

    // 输出格式为文件名，如 "package-name-1.0.0.tgz"
    return stdout.trim()
  }

  /**
   * 发布包
   */
  async publish(
    packagePath: string,
    options: NpmCliOptions & { tag?: string; otp?: string } = {},
  ): Promise<void> {
    const args = ['publish']
    if (options.tag) {
      args.push('--tag', options.tag)
    }
    if (options.registry) {
      args.push('--registry', options.registry)
    }
    if (options.otp) {
      args.push('--otp', options.otp)
    }

    const env = this.buildEnv(options)

    try {
      await execFileAsync(this.npmPath, args, {
        timeout: 120000,
        cwd: packagePath,
        env,
      })
    } catch (error: any) {
      if (error.stderr?.includes('ENEEDAUTH')) {
        throw new Error('未登录，请先运行 npm adduser 或配置 authToken')
      }
      if (error.stderr?.includes('EOTP')) {
        throw new Error('需要 OTP 验证码')
      }
      if (error.stderr?.includes('E409')) {
        throw new Error('版本已存在，请更新 version')
      }
      throw error
    }
  }

  /**
   * 取消发布
   */
  async unpublish(
    packageName: string,
    version: string,
    options: NpmCliOptions = {},
  ): Promise<void> {
    const args = ['unpublish', `${packageName}@${version}`]
    if (options.registry) {
      args.push('--registry', options.registry)
    }

    const env = this.buildEnv(options)

    try {
      await execFileAsync(this.npmPath, args, {
        timeout: 30000,
        env,
      })
    } catch (error: any) {
      if (error.stderr?.includes('ENEEDAUTH')) {
        throw new Error('未登录，请先运行 npm adduser 或配置 authToken')
      }
      throw error
    }
  }

  /**
   * 添加包 owner
   */
  async addOwner(
    user: string,
    packageName: string,
    options: NpmCliOptions = {},
  ): Promise<void> {
    const args = ['owner', 'add', user, packageName]
    if (options.registry) {
      args.push('--registry', options.registry)
    }

    const env = this.buildEnv(options)

    await execFileAsync(this.npmPath, args, {
      timeout: 15000,
      env,
    })
  }

  /**
   * 移除包 owner
   */
  async removeOwner(
    user: string,
    packageName: string,
    options: NpmCliOptions = {},
  ): Promise<void> {
    const args = ['owner', 'rm', user, packageName]
    if (options.registry) {
      args.push('--registry', options.registry)
    }

    const env = this.buildEnv(options)

    await execFileAsync(this.npmPath, args, {
      timeout: 15000,
      env,
    })
  }

  /**
   * 构建环境变量
   */
  private buildEnv(options: NpmCliOptions): NodeJS.ProcessEnv {
    const env = { ...process.env }

    if (options.authToken) {
      // 设置 auth token 到环境变量
      // npm 会从 NPM_TOKEN 或 npm_config_//registry/:_authToken 读取
      const registry = options.registry || 'https://registry.npmjs.org/'
      const normalizedUrl = registry.endsWith('/') ? registry : `${registry}/`
      env[`npm_config_${normalizedUrl}_authToken`] = options.authToken
      env['NPM_TOKEN'] = options.authToken
    }

    return env
  }
}
