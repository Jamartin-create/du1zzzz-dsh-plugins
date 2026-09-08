# dsh-plugin-npm

在 DeepSeek Harness 中管理你的 npm 包的 DSH 插件。

- **远端包管理**：查看你的 npm 账号下的所有包，支持同步到本地缓存
- **本地包管理**：添加本地包目录，自动验证是否符合发布要求
- **多 Registry 支持**：配置多个 npm registry（官方源、私有源等）
- **一键发布**：从 DSH 直接发布包到指定 registry
- **Agent 工具**：提供 `npm_*` 系列工具，让 agent 帮你管理包

## 安装

安装到某个 profile（以 `desktop` 为例）：

```bash
dsh plugin --profile desktop add dsh-plugin-npm   # 或本地路径
```

或手动：在 `~/.dsh/profiles/<profile>/package.json` 的 `dependencies` 里加
`"dsh-plugin-npm": "file:../.."`（或版本号），把 `"dsh-plugin-npm"` 加入
`dsh.profile.bundles`，然后在该目录执行 `CI=true pnpm install --no-frozen-lockfile`。

本仓源码的日常开发迭代见根 README 的「本地安装到 DSH」（`scripts/install-local.sh`）。

## 配置

### 全局配置（设置 → npm）

- **Registry 管理**：添加/编辑/删除 npm registry（存于本地 SQLite，见「数据存储」）
  - `name`：显示名称；`url`：Registry URL；`scope`：绑定的 scope（如 `@my-company`）
  - `authToken`：认证 token；`isDefault`：是否为默认源；`syncEnabled`：是否参与同步
  - 首次启动自动写入 npmjs 官方源（`https://registry.npmjs.org/`，默认源、启用同步）
- **自动同步**：`autoSync.enabled`（默认开）、`autoSync.intervalMs`（默认 1800000，即 30 分钟）
- **数据源优先级** `sourcePriority`：
  - `cli-first`：优先使用 npm CLI（默认，推荐）
  - `api-first`：优先使用 HTTP API
  - `cache-only`：仅使用本地缓存
- **默认发布 tag** `defaultPublishTag`：默认 `latest`

改完即时生效（`applies: live`）。

## 工具与行为

### 侧边栏入口

点击侧边栏底部的 npm 图标，打开包管理面板：

- **远端包 Tab**：查看你的 npm 包列表，点击「同步」刷新
- **本地包 Tab**：管理本地包，点击「添加本地包」开始

### Agent 工具

| 工具名 | 说明 |
|--------|------|
| `npm_list_packages` | 列出远端包 |
| `npm_view_package` | 查看包详情 |
| `npm_validate_package` | 验证本地包是否符合发布要求 |
| `npm_add_local_package` | 添加本地包 |
| `npm_list_local_packages` | 列出本地包 |
| `npm_publish` | 发布包 |
| `npm_sync` | 同步包列表到本地缓存 |

### 发布流程

1. 在「本地包」Tab 点击「添加本地包」
2. 输入本地包路径（如 `/Users/you/projects/my-package`）
3. 插件会自动验证包是否符合要求
4. 验证通过后，点击「发布」按钮
5. 确认发布，等待完成

## 数据存储

- 数据库位置：`~/.dsh/plugins/dsh-plugin-npm/npm.db`
- 基于 `node:sqlite`（需 Node.js `^22.19.0 || >=24.0.0`），WAL 模式
- 存储 registry 配置、包信息、同步记录、发布记录

## 文件结构

- `src/index.ts` — Host 入口：注册 settings 命名空间、Web API 路由、agent 工具、自动同步调度
- `src/config.ts` — 配置 schema 与默认值；默认 registry（npmjs）定义
- `src/sqlite.ts` — SQLite 存储层（`node:sqlite`，WAL）
- `src/npm-cli.ts` — npm CLI 封装（数据源首选）
- `src/registry-api.ts` — Registry HTTP API（CLI 不可用时的兜底）
- `src/data-source.ts` — 数据源统一层（`cli-first` / `api-first` / `cache-only`）
- `src/sync.ts` — 同步管理器（自动同步调度）
- `src/publish.ts` — 发布管理器
- `src/validator.ts` — 本地包发布前校验
- `src/routes.ts` — Web API 路由（`/plugins/dsh-plugin-npm/*`，供 client 调用）
- `src/tool.ts` — `npm_*` 系列 agent 工具
- `src/types.ts` — 类型定义
- `src/client/index.tsx` — Client 端：侧边栏入口面板 + 设置 section
- `tsdown.config.ts` / `tsdown.client.config.ts` — Host（node ESM）与 Client（browser）两套构建

## License

MIT
