import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'module'
import type { NpmViewResult } from './types'

const execFileAsync = promisify(execFile)

/** npm 发布要求 OTP（账号/registry 启用了 2FA）时抛出，code === 'EOTP' */
export class NpmOtpRequiredError extends Error {
  readonly code = 'EOTP'
  constructor(message: string) {
    super(message)
    this.name = 'NpmOtpRequiredError'
  }
}

// ========== node-pty（可选依赖，从 DSH profile 的 node_modules 解析） ==========

/** node-pty 进程句柄的最小类型（本工作区没有 node-pty 的类型定义） */
interface PtyProcess {
  write(data: string): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (event: { exitCode: number; signal?: number }) => void): void
}

interface NodePtyModule {
  spawn(
    file: string,
    args: string[],
    options: {
      name?: string
      cwd?: string
      env?: Record<string, string>
      cols?: number
      rows?: number
    },
  ): PtyProcess
}

let nodePtyCache: NodePtyModule | null | undefined // undefined = 尚未尝试加载

/**
 * 惰性加载 node-pty。插件从 profiles/<profile>/node_modules/dsh-plugin-npm/lib/
 * 加载，createRequire 会沿目录向上解析到 profile 根，找到宿主自带的 node-pty。
 * 加载失败（如纯 web 部署）返回 null，调用方回退到 execFile。
 */
function loadNodePty(): NodePtyModule | null {
  if (nodePtyCache !== undefined) return nodePtyCache
  try {
    const require = createRequire(import.meta.url)
    nodePtyCache = require('node-pty') as NodePtyModule
  } catch {
    nodePtyCache = null
  }
  return nodePtyCache
}

/** 去除 ANSI 转义序列（PTY 输出带颜色/光标控制码，匹配前必须清理） */
function stripAnsi(text: string): string {
  return text.replace(
    // eslint-disable-next-line no-control-regex
    /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|[@-Z\\-_])/g,
    '',
  )
}

const OTP_PROMPT_PATTERN = /enter (?:one-time|otp)|one-time password/i
const WEB_AUTH_TITLE_PATTERN = /authenticate your account at/i
const WEB_AUTH_ENTER_PATTERN = /press enter to open/i

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
  private logger: any

  constructor(npmPath = 'npm', logger?: any) {
    this.npmPath = npmPath
    this.logger = logger
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
   * 发布包。
   * 不带 --otp 且 node-pty 可用时在 PTY 中运行：npm 的 web 2FA
   * （"Authenticate your account at <url>" + 浏览器验证）依赖 TTY 才会触发。
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
      if (!options.otp && loadNodePty() !== null) {
        // 浏览器验证流程可能需要用户操作，放宽到 3 分钟
        await this.runInteractive(args, options, { timeout: 180000, cwd: packagePath })
      } else {
        await this.run(args, options, {
          timeout: 120000,
          cwd: packagePath,
        })
      }
    } catch (error: any) {
      if (error?.code === 'EOTP') throw error
      if (error.stderr?.includes('ENEEDAUTH')) {
        throw new Error('未登录，请先运行 npm adduser 或配置 authToken')
      }
      const output = `${error.stderr ?? ''}\n${error.stdout ?? ''}`
      if (/EOTP|one-time pass|two-factor authentication/i.test(output)) {
        throw new NpmOtpRequiredError('需要 OTP 验证码（该 registry 对发布启用了 2FA）')
      }
      if (error.stderr?.includes('E409')) {
        throw new Error('版本已存在，请更新 version')
      }
      throw error
    }
  }

  /**
   * 取消发布（同样需要 OTP/2FA 支持，PTY 规则同 publish）
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
      if (loadNodePty() !== null) {
        await this.runInteractive(args, options, { timeout: 180000 })
      } else {
        await this.run(args, options, {
          timeout: 30000,
        })
      }
    } catch (error: any) {
      if (error?.code === 'EOTP') throw error
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
   * 准备认证参数：若提供了 authToken，写入一个一次性的临时 userconfig
   * （绝不修改用户的真实 .npmrc），调用方负责在结束后清理 tempDir。
   */
  private async prepareAuth(
    args: string[],
    options: NpmCliOptions,
  ): Promise<{ finalArgs: string[]; tempDir?: string }> {
    if (!options.authToken) return { finalArgs: args }
    const prepared = await this.createUserConfig(options)
    return { finalArgs: [...args, '--userconfig', prepared.file], tempDir: prepared.dir }
  }

  private async cleanupTempDir(tempDir: string | undefined) {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }

  /**
   * 以 execFile 执行 npm 命令（无 TTY）。
   */
  private async run(
    args: string[],
    options: NpmCliOptions,
    execOptions: ExecOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    const { finalArgs, tempDir } = await this.prepareAuth(args, options)

    try {
      return await execFileAsync(this.npmPath, finalArgs, {
        ...execOptions,
        env: { ...process.env },
      })
    } finally {
      await this.cleanupTempDir(tempDir)
    }
  }

  /**
   * 在 PTY 中执行 npm 命令（publish/unpublish 的 2FA 流程需要 TTY）。
   * 阻塞直到 npm 退出：web 2FA 由 npm 内部完成 opener + doneUrl 轮询。
   */
  private async runInteractive(
    args: string[],
    options: NpmCliOptions,
    execOptions: ExecOptions,
  ): Promise<string> {
    const { finalArgs, tempDir } = await this.prepareAuth(args, options)

    try {
      return await this.runPty(finalArgs, {
        cwd: execOptions.cwd,
        env: { ...process.env } as Record<string, string>,
        timeoutMs: execOptions.timeout,
      })
    } finally {
      await this.cleanupTempDir(tempDir)
    }
  }

  /**
   * PTY 执行核心。返回清理过 ANSI 码的全部输出。
   *
   * - 看到 classic OTP 提示（"Enter OTP:" / "one-time password"）说明 npm 在等
   *   stdin，我们无法满足 → 杀进程并抛 NpmOtpRequiredError，走已有的 otpRequired UI 流程。
   * - 看到 web-auth 输出时 npm 会先打印 "Authenticate your account at:\n<url>"，
   *   然后提示 "Press ENTER to open in the browser..." 等待回车——替用户按回车，
   *   浏览器随即打开，npm 自行轮询 doneUrl 直到用户完成验证。
   */
  private runPty(
    args: string[],
    options: { cwd?: string; env: Record<string, string>; timeoutMs: number },
  ): Promise<string> {
    const pty = loadNodePty()
    if (!pty) return Promise.reject(new Error('node-pty 不可用'))

    return new Promise<string>((resolve, reject) => {
      let output = ''
      let settled = false
      let sentEnter = false

      const proc = pty.spawn(this.npmPath, args, {
        name: 'xterm-color',
        cwd: options.cwd,
        env: options.env,
        cols: 120,
      })

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          proc.kill()
        } catch {
          // 进程可能已退出
        }
        fn()
      }

      const timer = setTimeout(() => {
        settle(() => reject(new Error(`npm 命令超时（${Math.round(options.timeoutMs / 60000)} 分钟）`)))
      }, options.timeoutMs)

      proc.onData((data) => {
        if (settled) return
        output += data
        const stripped = stripAnsi(output)

        // classic OTP：npm 在等 stdin 输入验证码，无法满足
        if (OTP_PROMPT_PATTERN.test(stripped)) {
          settle(() =>
            reject(new NpmOtpRequiredError('需要 OTP 验证码（该 registry 对发布启用了 2FA）')),
          )
          return
        }

        // web 2FA：npm 等回车来打开浏览器
        if (!sentEnter && WEB_AUTH_ENTER_PATTERN.test(stripped)) {
          sentEnter = true
          this.logger?.info?.('dsh-plugin-npm: npm 请求浏览器 2FA 验证，正在打开浏览器，请在浏览器中完成验证')
          proc.write('\r')
          return
        }
        if (WEB_AUTH_TITLE_PATTERN.test(stripped)) {
          this.logger?.info?.('dsh-plugin-npm: npm 浏览器 2FA 验证流程已启动')
        }
      })

      proc.onExit(({ exitCode }) => {
        const stripped = stripAnsi(output)
        settle(() => {
          if (exitCode === 0) {
            resolve(stripped)
            return
          }
          if (/ENEEDAUTH/.test(stripped)) {
            reject(new Error('未登录，请先运行 npm adduser 或配置 authToken'))
            return
          }
          // EOTP 也可能以错误文本（而非提示符）出现
          if (/EOTP|one-time pass|two-factor authentication/i.test(stripped)) {
            reject(new NpmOtpRequiredError('需要 OTP 验证码（该 registry 对发布启用了 2FA）'))
            return
          }
          if (/E409/.test(stripped)) {
            reject(new Error('版本已存在，请更新 version'))
            return
          }
          const tail = stripped.trim().split('\n').slice(-10).join('\n')
          const error = new Error(`npm 命令失败（exit ${exitCode}）:\n${tail}`) as any
          error.stderr = stripped
          reject(error)
        })
      })
    })
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
