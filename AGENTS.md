# AGENTS.md

本仓收录自维护的 DeepSeek Harness（DSH）插件。这份文件记录 DSH 插件的开发流程与平台经验，
供后续开发（人或 AI agent）直接上手。**改代码前请先读完「平台要点」**，里面都是踩过的坑。

## 仓库结构

```
plugins/<name>/          # 每个插件一个 pnpm workspace 包
  src/                   # host 侧源码（Node，运行在 DSH 主进程）
  src/client/index.tsx   # client 侧源码（浏览器，React）
  cordis.patch.yml       # cordis loader patch，安装时把插件插入宿主 bundle
  package.json           # files 只列 lib/ + cordis.patch.yml；peerDeps 声明宿主 API 包
scripts/install-local.sh # 构建 + 同步到本机 DSH profile（日常迭代的核心工具）
```

## 日常开发循环

```bash
# 1. 改代码（host: src/；client: src/client/）
# 2. 构建并同步进本机 profile
scripts/install-local.sh <plugin-name> [profile]   # profile 默认 desktop
# 3. 生效
#    - host 侧（src/）：重启 DSH Desktop
#    - client 侧（src/client/）：浏览器刷新页面
```

提交前：`pnpm typecheck && pnpm build`。

## 安装机制（DSH 如何加载插件）

运行时只认 profile 目录下的拷贝：`$DSH_HOME/profiles/<profile>/node_modules/<plugin>`。
它由 profile 的 `package.json` 声明，pnpm 安装产生：

```json
// ~/.dsh/profiles/desktop/package.json
"dsh-plugin-ntfy": "file:/absolute/path/to/du1zzzz-dsh-plugins/plugins/dsh-plugin-ntfy"
```

- 一次性设置：改好 file: 路径后 `cd ~/.dsh/profiles/<profile> && CI=true pnpm install --no-frozen-lockfile`
  （改了 file: 路径就必须重装，否则 lockfile 不匹配会把旧拷贝删掉）
- **pnpm 的 file: 依赖是安装时拷贝（hard link），不是活链接**；且 tsdown 构建的 clean 会打断
  hard link，导致 profile 里的拷贝变成旧代码。所以每次改完必须用 install-local.sh 显式同步，
  不要指望 pnpm install 之后自动跟随源码
- client 产物 `lib/client.js` 是 tsdown 用 `__ModuleLoader__.load` 包装出来的浏览器 bundle，
  host 产物 `lib/index.js` 保持对 `@deepseek-ai/*` 的外部 import（由宿主解析）

## 平台要点（都是实际踩坑换来的）

1. **host 插件默认不热重载**。cordis-plugin-hmr 在 dsh-base 里 `disabled: true`，
   host 侧代码改动必须重启 DSH Desktop 才生效；client 侧刷新页面即可。
   判断改动是否生效不要猜——用实际行为验证（比如调插件注册的 HTTP 路由）。

2. **`llm.stream()` 的适配器错误不会 throw**。供应商报错（余额不足、配额、传输错误等）
   以流内终止 `finish` chunk 交付：`{ type: "finish", reason: { kind: "error"|"aborted",
   failure: { message, code } } }`。流会"正常"结束、零内容块。
   **消费端必须检查 `assembler.finish`**，否则供应商故障会被误报成"输出解析失败"。
   （dsh-plugin-ntfy 的 analyze 曾因此把 Insufficient Balance 误报为 "model produced no valid JSON"）

3. **`BlockAssembler.blocks()` 会把未闭合的块也从 delta 拼出来**，流被 max-tokens 截断时
   依然能拿到部分内容；`finish.kind === "max-tokens"` 时工具调用块会被丢弃。

4. **读会话内容用 `sessionQuery` 服务**（`ctx.get("sessionQuery", false)`）：
   - `readTitleSnapshot(sessionId, signal)` → `{ session, title? }`，没标题时 title 为空
   - `filterEvents(sessionId, [{ kind: "surface", values: ["current"] },
     { kind: "type", values: ["user/message", "assistant/message"] }])`
     → `[{ seq, type, time, surface, text }]`，按 seq 升序，text 是提取的语义文本
   - 小模型辅助调用的路由：`ctx.get("agentDefaultModel", false)?.currentSelection?.()`
     拿 `{ provider, model }`，`ctx.get("llm", false)` 拿 llm 服务

5. **插件可用的宿主服务**（cordis inject/get）：`settings`（`register(ns, schema, { applies: "live" })`
   注册设置命名空间）、`webServer`（`register({ kind: "exact", path, handler })` 注册 HTTP 路由）、
   `systemPrompt`（`section({ name, order, text })` 注入系统提示词）、`jobs`（`onJobDone`）、
   `sessions`（`on("session/event" | "session/disposed")`）、`tools`（`register(defineTool(...))`）、
   `credentials`（`resolve(envName)` 读密钥）。client 侧有 `slots`（`inject` + `register` 挂 UI）、
   `settingsScope`、`connection`。

6. **ntfy 推送**：非 ASCII 的 header（Title/Tags）要 RFC 2047 base64 编码；body 里放
   Markdown 时设 `Markdown: yes` 头。认证优先级：Bearer token > Basic（username+password）>
   匿名；配置值是大写环境变量名时经 credentials/环境变量解析，否则按字面量用。

7. **日志位置**：`~/Library/Application Support/DSH Desktop/logs/dsh-YYYY-MM-DD.log`。
   排查插件问题先 grep 插件名。

8. **npm/包管理环境**：本机 pnpm 11；profile 目录里 pnpm install 若因无 TTY 中断，
   加 `CI=true`；lockfile 与 manifest 不匹配时加 `--no-frozen-lockfile`。
   本机 GitHub 无 SSH key，git 操作用 HTTPS + `gh auth setup-git` 配置的凭据助手。

## 发布

```bash
pnpm --filter <plugin-name> publish   # prepack 会自动先 build
```

社区市场（dshmarket）从 npm 安装；上架需向 awesome-dsh-plugin 仓库提 PR 加条目。
