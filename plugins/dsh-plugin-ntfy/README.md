# dsh-plugin-ntfy

给 DeepSeek Harness 添加 [ntfy](https://ntfy.sh) 推送通知能力的 DSH 插件。

- **自动通知**：监听「用户回合完成/失败」与「后台任务完成/失败」事件，自动推送到你的 ntfy topic。
- **手动工具**：向 agent 提供 `ntfy_notify` 工具，可主动发通知（内容与优先级由 agent 决定）。
- **按会话（per-session）配置**：会话头部右上角的 ntfy 按钮，为每个会话单独设置「标题前缀 + 固定 tag + 是否开启」。
- **设置面板**：设置里的独立「ntfy」栏，配置 server / topic / 认证 / 全局开关。

本期只做「发布」（发通知），「订阅」（收 ntfy 消息）不在本期范围。

## 安装

1. 构建：`pnpm install && pnpm build`
2. 把本插件装进你的 profile（以 `desktop` 为例）：

   ```bash
   dsh plugin --profile desktop add <本包名或本地路径>
   ```

   或手动：在 `profiles/desktop/package.json` 的 `dependencies` 里加 `"dsh-plugin-ntfy": "file:../.."`，并把 `"dsh-plugin-ntfy"` 加入 `dsh.profile.bundles`，然后在该目录 `pnpm install`。

## 配置

### 全局配置（设置 → ntfy）

- `Server`：默认 `https://ntfy.sh`，可换成自建实例
- `Topic`：你的 ntfy topic（本质是密码，用随机名，`[-_A-Za-z0-9]`，最长 64）
- 认证（自建实例启用了 access control 时填）：
  - `Username` + `Password`：HTTP Basic（`Authorization: Basic base64(user:pass)`）
  - `Access token`：Bearer（`Authorization: Bearer tk_...`），优先于用户名密码
  - 密码/token 字段可直接填字面量；填**全大写环境变量名**（如 `NTFY_PASSWORD`）则从 DSH credentials / 进程环境读取
- `Timeout (ms)`
- 四个全局开关：回合完成 / 回合失败 / 后台任务完成 / 后台任务失败

改完即时生效（`applies: live`）。

### 按会话配置（会话头部右上角 → ntfy 按钮）

每个会话单独设置：

- **是否开启**本会话的推送
- **标题前缀**：发送时标题变为 `前缀 - 会话标题`，如「需求A - 修复登录bug」
- **Tag**：固定标签/emoji 短码，如 `heavy_check_mark`、`warning`

## 发送行为

| 场景 | title | tag | content | priority |
|---|---|---|---|---|
| 回合自动通知 | `前缀 - 会话标题` | 固定 tag | 完成 / 失败（原因） | 默认 / 高 |
| agent 手动 `ntfy_notify` | `前缀 - {agent title}` | 固定 tag + agent tags | agent 决定 | agent 决定 |

插件会注入一段系统提示词，引导 agent 在任务完成/需要关注时用 `ntfy_notify` 发一条**一句话**的简洁通知（内容与优先级由 agent 决定，标题前缀与 tag 自动套用）。

## 测试

发布一条测试通知（在已配置 topic 后）：

```bash
curl -d "hello from dsh" -H "Title: test" https://ntfy.sh/my-secret-topic-abc123
```

在 DSH 里让 agent 调 `ntfy_notify`：

```text
请用 ntfy_notify 给我发一条通知，内容是「部署完成」。
```

## 结构

- `src/index.ts` — Host 入口：`name`/`inject`/`apply`，注册 settings 命名空间、工具、触发器、系统提示词
- `src/config.ts` — 配置 schema（schemastery）与类型、默认值（含 `sessionOverrides`）
- `src/publish.ts` — ntfy 发布（`fetch` POST + Title/Priority/Tags/Click/Markdown 头、Basic/Bearer、RFC 2047 非 ASCII 头编码）
- `src/triggers.ts` — `jobs.onJobDone` 与 `session/event`（turn 开始/结束）自动通知 + per-session 覆盖
- `src/tool.ts` — `ntfy_notify` 手动工具（session 感知，自动套用前缀/tag）
- `src/client/index.tsx` — Client 端：设置 section + 会话头部 ntfy 按钮 + 弹窗表单
- `tsdown.config.ts` / `tsdown.client.config.ts` — Host（node ESM）与 Client（browser）两套构建
