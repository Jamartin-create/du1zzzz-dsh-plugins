# du1zzzz-dsh-plugins

自维护的 DeepSeek Harness（DSH）插件集，pnpm workspace monorepo。

这份 README 是仓库概览；开发流程、安装机制与平台踩坑记录见 [AGENTS.md](AGENTS.md)（AI agent / 贡献者改代码前必读）。

## 插件清单

| 插件 | 说明 |
|---|---|
| [dsh-plugin-ntfy](plugins/dsh-plugin-ntfy/) | 回合/后台任务完成与失败的 ntfy 推送，`ntfy_notify` 工具，AI 标题分析与 Markdown 总结正文 |
| [dsh-plugin-npm](plugins/dsh-plugin-npm/) | npm 包管理：远端包查看/同步、本地包校验与一键发布、多 registry、`npm_*` 系列 agent 工具 |

## 仓库结构

```
plugins/<name>/          # 每个插件一个 pnpm workspace 包
scripts/install-local.sh # 构建 + 同步到本机 DSH profile（日常迭代的核心工具）
```

## 环境要求

- Node.js `^22.19.0 || >=24.0.0`（dsh-plugin-npm 用到 `node:sqlite`）
- pnpm 11

## 开发

```bash
pnpm install
pnpm typecheck    # 全部插件类型检查
pnpm build        # 全部插件构建
```

新插件放 `plugins/<name>/`，tsconfig extends 根目录的 `tsconfig.base.json`，
`typescript` / `tsdown` / `@types/node` 由根目录统一提供。

## 本地安装到 DSH

日常迭代用脚本，构建并同步到 `$DSH_HOME/profiles/<profile>/node_modules/<plugin>`：

```bash
scripts/install-local.sh <plugin-name> [profile]   # 默认 profile: desktop
```

host 侧改动需重启 DSH Desktop，client 侧改动刷新页面即可。

首次把某个插件接入一个 profile 时，在该 profile 的 `package.json` 里加 `file:` 依赖，
并把插件名加入 `dsh.profile.bundles`：

```json
{
  "dependencies": {
    "dsh-plugin-ntfy": "file:/path/to/du1zzzz-dsh-plugins/plugins/dsh-plugin-ntfy"
  },
  "dsh": { "profile": { "bundles": ["...", "dsh-plugin-ntfy"] } }
}
```

改完在该 profile 目录执行 `CI=true pnpm install --no-frozen-lockfile`。

## 发布

各插件 package.json 保持独立完整（name/version/files），发布时：

```bash
pnpm --filter <plugin-name> publish   # prepack 会自动先 build
```
