# dsh-plugin-npm

在 DeepSeek Harness 中管理你的 npm 包。

## 功能

- **远端包管理**：查看你的 npm 账号下的所有包，支持同步到本地缓存
- **本地包管理**：添加本地包目录，自动验证是否符合发布要求
- **多 Registry 支持**：配置多个 npm registry（官方源、私有源等）
- **一键发布**：从 DSH 直接发布包到指定 registry
- **Agent 工具**：提供 npm_* 系列工具，让 Agent 帮你管理包

## 安装

1. 构建：`pnpm install && pnpm build`
2. 把本插件装进你的 profile：

   ```bash
   dsh plugin --profile desktop add <本包名或本地路径>
   ```

## 配置

### 全局配置（设置 → npm）

- **Registry 配置**：添加/编辑/删除 npm registry
  - `name`：显示名称
  - `url`：Registry URL
  - `scope`：绑定的 scope（如 `@my-company`）
  - `authToken`：认证 token
  - `isDefault`：是否为默认源
  - `syncEnabled`：是否启用自动同步

- **自动同步**：
  - `enabled`：是否启用自动同步
  - `intervalMs`：同步间隔（默认 30 分钟）

- **数据源优先级**：
  - `cli-first`：优先使用 npm CLI（推荐）
  - `api-first`：优先使用 HTTP API
  - `cache-only`：仅使用本地缓存

### 默认配置

```yaml
dsh-plugin-npm:
  registries:
    - id: npmjs
      name: npmjs
      url: https://registry.npmjs.org/
      isDefault: true
      syncEnabled: true
  autoSync:
    enabled: true
    intervalMs: 1800000
  sourcePriority: cli-first
  defaultPublishTag: latest
```

## 使用

### 侧边栏入口

点击侧边栏底部的 npm 图标，打开包管理面板：

- **远端包 Tab**：查看你的 npm 包列表，点击"同步"刷新
- **本地包 Tab**：管理本地包，点击"添加本地包"开始

### Agent 工具

| 工具名 | 说明 |
|--------|------|
| `npm_list_packages` | 列出远端包 |
| `npm_view_package` | 查看包详情 |
| `npm_validate_package` | 验证本地包 |
| `npm_add_local_package` | 添加本地包 |
| `npm_list_local_packages` | 列出本地包 |
| `npm_publish` | 发布包 |
| `npm_sync` | 同步包列表 |

### 发布流程

1. 在"本地包" Tab 点击"添加本地包"
2. 输入本地包路径（如 `/Users/you/projects/my-package`）
3. 插件会自动验证包是否符合要求
4. 验证通过后，点击"发布"按钮
5. 确认发布，等待完成

## 数据存储

- 数据库位置：`~/.dsh/plugins/dsh-plugin-npm/npm.db`
- 使用 SQLite 存储包信息、同步记录、发布记录
- 支持 WAL 模式，性能优秀

## 技术架构

```
┌─────────────────────────────────────────────────┐
│  Client (React)                                  │
│  - 侧边栏按钮 → shell.overlay                   │
│  - 设置页面 → settings.section                   │
├─────────────────────────────────────────────────┤
│  Host (Node.js)                                  │
│  - SQLite 数据库                                 │
│  - npm CLI 封装                                  │
│  - Registry HTTP API（兜底）                     │
│  - 数据源统一层                                  │
│  - 同步管理器                                    │
│  - 发布管理器                                    │
│  - Agent 工具                                    │
│  - Web API 路由                                  │
└─────────────────────────────────────────────────┘
```

## License

MIT
