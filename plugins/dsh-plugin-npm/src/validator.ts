import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import type { ValidationResult, PackageMetadata } from './types'

/**
 * 验证本地包是否符合发布要求
 */
export async function validateLocalPackage(packagePath: string): Promise<ValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. 检查目录是否存在
  if (!existsSync(packagePath)) {
    errors.push(`目录不存在: ${packagePath}`)
    return { valid: false, errors, warnings }
  }

  // 2. 检查 package.json 是否存在
  const pkgPath = join(packagePath, 'package.json')
  if (!existsSync(pkgPath)) {
    errors.push('缺少 package.json 文件')
    return { valid: false, errors, warnings }
  }

  // 3. 读取并验证 package.json
  let pkg: any
  try {
    const content = readFileSync(pkgPath, 'utf-8')
    pkg = JSON.parse(content)
  } catch (error: any) {
    errors.push(`package.json 解析失败: ${error.message}`)
    return { valid: false, errors, warnings }
  }

  // 必填字段
  if (!pkg.name) {
    errors.push('package.json 缺少 name 字段')
  } else {
    // 验证包名格式
    const nameRegex = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
    if (!nameRegex.test(pkg.name)) {
      errors.push(`包名格式无效: ${pkg.name}`)
    }
  }

  if (!pkg.version) {
    errors.push('package.json 缺少 version 字段')
  } else {
    // 验证版本号格式（简单校验）
    const versionRegex = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/
    if (!versionRegex.test(pkg.version)) {
      errors.push(`版本号格式无效: ${pkg.version}`)
    }
  }

  // 推荐字段
  if (!pkg.description) {
    warnings.push('建议添加 description 字段')
  }
  if (!pkg.license) {
    warnings.push('建议添加 license 字段')
  }
  if (!pkg.repository) {
    warnings.push('建议添加 repository 字段')
  }
  if (!pkg.author) {
    warnings.push('建议添加 author 字段')
  }

  // 4. 检查入口文件
  if (pkg.main) {
    const mainPath = join(packagePath, pkg.main)
    if (!existsSync(mainPath)) {
      // 检查是否需要构建
      if (existsSync(join(packagePath, 'src'))) {
        warnings.push(`入口文件 ${pkg.main} 不存在，但存在 src 目录，可能需要先构建`)
      } else {
        errors.push(`入口文件 ${pkg.main} 不存在`)
      }
    }
  }

  // 5. 检查 types 文件
  if (pkg.types) {
    const typesPath = join(packagePath, pkg.types)
    if (!existsSync(typesPath)) {
      warnings.push(`类型声明文件 ${pkg.types} 不存在`)
    }
  }

  // 6. 检查 .npmignore 或 files 字段
  if (!pkg.files && !existsSync(join(packagePath, '.npmignore'))) {
    warnings.push('建议添加 .npmignore 或 files 字段以控制发布内容')
  }

  // 7. 检查 README
  if (!existsSync(join(packagePath, 'README.md')) &&
      !existsSync(join(packagePath, 'readme.md'))) {
    warnings.push('建议添加 README.md 文件')
  }

  // 8. 检查 node_modules（不应该发布）
  if (existsSync(join(packagePath, 'node_modules'))) {
    warnings.push('node_modules 目录存在，确保 .npmignore 已排除')
  }

  // 9. 检查 .git 目录
  if (existsSync(join(packagePath, '.git'))) {
    // npm 会自动排除 .git，这里只是提醒
  }

  // 10. 检查私有包配置
  if (pkg.private === true) {
    warnings.push('package.json 中 private 设置为 true，npm publish 会拒绝发布')
  }

  // 构建元数据
  const metadata: PackageMetadata = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    main: pkg.main,
    types: pkg.types,
    files: pkg.files,
    license: pkg.license,
    repository: typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url,
    homepage: pkg.homepage,
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    metadata,
  }
}

/**
 * 读取 package.json 内容
 */
export function readPackageJson(packagePath: string): any | null {
  const pkgPath = join(packagePath, 'package.json')
  if (!existsSync(pkgPath)) {
    return null
  }

  try {
    const content = readFileSync(pkgPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    return null
  }
}
