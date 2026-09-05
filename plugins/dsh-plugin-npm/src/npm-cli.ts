import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { NpmViewResult } from './types'

const execFileAsync = promisify(execFile)

export interface NpmCliOptions {
  registry?: string
  cwd?: string
  authToken?: string
}

interface ExecOptions {
  timeout: number
  cwd?: string
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

    try {
      const { stdout } = await this.run(args, options, {
        timeout: 10000,
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

    try {
      const { stdout } = await this.run(args, options, {
        timeout: 15000,
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

    const { stdout } = await this.run(args, options, {
      timeout: 15000,
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

    const { stdout } = await this.run(args, options, {
      timeout: 60000,
      cwd: packagePath,
    })

    // 输出格式为文件名，如 "package-name-1.0.0.tgz"
    // npm 可能在 filename 前后打印额外行，取最后一行
    const lines = stdout.trim().split('\n').filter(Boolean)
    return lines[lines.length - 1].trim()
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

    try {
      await this.run(args, options, {
        timeout: 120000,
        cwd: packagePath,
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

    try {
      await this.run(args, options, {
        timeout: 30000,
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

    await this.run(args, options, {
      timeout: 15000,
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

    await this.run(args, options, {
      timeout: 15000,
    })
  }

  /**
   * 执行 npm 命令。若提供了 authToken，写入一个一次性的临时 userconfig
   * （绝不修改用户的真实 .npmrc），命令结束后删除临时文件。
   */
  private async run(
    args: string[],
    options: NpmCliOptions,
    execOptions: ExecOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    let finalArgs = args
    let tempDir: string | undefined

    if (options.authToken) {
      const prepared = await this.createUserConfig(options)
      finalArgs = [...args, '--userconfig', prepared.file]
      tempDir = prepared.dir
    }

    try {
      return await execFileAsync(this.npmPath, finalArgs, {
        ...execOptions,
        env: { ...process.env },
      })
    } finally {
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  /**
   * 为单次调用创建临时 userconfig，内容形如：
   *   //registry.npmjs.org/:_authToken=<token>
   * host 部分为 registry URL 去掉协议、保留结尾斜杠后的部分。
   */
  private async createUserConfig(options: NpmCliOptions): Promise<{ dir: string; file: string }> {
    const registry = options.registry || 'https://registry.npmjs.org/'
    const normalized = registry.endsWith('/') ? registry : `${registry}/`
    const host = normalized.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
    const content = `//${host}:_authToken=${options.authToken}\n`

    const dir = await mkdtemp(join(tmpdir(), 'dsh-plugin-npm-'))
    const file = join(dir, '.npmrc')
    await writeFile(file, content, { mode: 0o600 })
    return { dir, file }
  }
}
