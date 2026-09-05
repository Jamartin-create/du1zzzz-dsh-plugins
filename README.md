# du1zzzz-dsh-plugins

自维护的 DeepSeek Harness 插件集（pnpm workspace monorepo）。

## 插件清单

| 插件 | 说明 |
|---|---|
| [dsh-plugin-ntfy](plugins/dsh-plugin-ntfy/) | 回合/后台任务完成与失败的 ntfy 推送，`ntfy_notify` 工具，AI 标题分析与 Markdown 总结正文 |

> AI agent / 贡献者请先读 [AGENTS.md](AGENTS.md)：完整的开发流程与 DSH 平台要点（坑）都在里面。

## 开发

```bash
pnpm install
pnpm typecheck    # 全部插件类型检查
pnpm build        # 全部插件构建
```

新插件放 `plugins/<name>/`，tsconfig extends 根目录的 `tsconfig.base.json`，
`typescript` / `tsdown` / `@types/node` 由根目录统一提供。

## 本地安装到 DSH

```bash
scripts/install-local.sh <plugin-name> [profile]   # 默认 profile: desktop
```

构建并同步到 `$DSH_HOME/profiles/<profile>/node_modules/<plugin>`。
host 侧改动需重启 DSH Desktop，client 侧改动刷新页面即可。

profile 中的引用方式（一次性设置）：

```json
"dsh-plugin-ntfy": "file:/path/to/du1zzzz-dsh-plugins/plugins/dsh-plugin-ntfy"
```

## 发布

各插件 package.json 保持独立完整（name/version/files），发布时：

```bash
pnpm --filter <plugin-name> publish
```
