# Cyberboss Roundtable

这是一个本地圆桌聊天应用。

打开它以后，用户可以在浏览器里和 Codex、Claude Code、DeepSeek 聊天，也可以把聊天放进固定房间、项目房间、临时话题里。服务端负责保存消息、调 AI runtime、做摘要、安排 check-in、显示当前谁在干活。

## 只想先跑起来

### 1. 准备

需要这些东西：

- Node.js，版本要能用 `node:sqlite`
- npm
- Codex CLI，想让 Codex 回话时需要
- Claude Code CLI，想让 Claude 回话时需要

在仓库根目录装依赖：

```powershell
npm install
```

### 2. 启动

```powershell
npm run roundtable
```

浏览器打开：

```text
http://127.0.0.1:8787
```

默认端口是 `8787`。

要换端口：

```powershell
$env:ROUNDTABLE_PORT='8797'
npm run roundtable
```

### 3. 发消息

在页面底部输入消息，发送。

- 发到群里时，Codex 和 Claude 都可能回。
- 点名 Codex 或 Claude 时，消息会优先给那个人。
- AI 发言里写 `@Claude` 或 `@Codex`，可以叫另一个 AI 接话。
- 消息可以带附件。

## 这个页面在干什么

### 房间和话题

圆桌真正保存的是 **topic**，可以理解成一段会话。

topic 可以放在：

- 固定房间
- 私聊
- 项目房间
- 临时话题

消息、摘要、审批、已读位置、runtime handoff 都跟着 topic 保存。

### Round

`Round` 是 Codex 和 Claude 的自动发言流程。

- `Start Round`：开始自动轮次
- `Pause`：暂停自动轮次
- `End`：结束当前 topic

AI 正在处理任务时，用户仍然可以发消息。普通消息默认会作为补充信息写进当前话题，不会中断正在跑的任务。需要中断时，用页面上的中断入口。

### 正在干活

状态面板主要回答四个问题：

- 现在谁在处理任务
- 谁刚处理完
- 是否卡在审批
- 是否有摘要任务或 runtime turn 在跑

这份任务状态也会进入 Codex 和 Claude 的 prompt。这样另一个 AI 醒来时能看到同桌的人正在做什么，减少重复处理。

### Summary

摘要用来照顾长话题。

- 手动点 Summary 时，默认总结当前 topic 里还没总结的消息。
- 自动摘要默认按新增 `30` 条消息触发。
- 配了 DeepSeek key 时，摘要优先走 DeepSeek。
- 配了 Gemini key 时，可以做摘要备用。

### Check-in

check-in 是系统按时间叫醒 Codex 或 Claude。

醒来后 AI 可以：

- 保持沉默
- 在群里发消息
- 自己定下次醒来的时间
- 先用论坛、联网、记忆库等工具，再决定要不要发言

check-in 默认开启。默认随机间隔是 10 到 60 分钟。

### 语音消息

Codex 或 Claude 的回复如果以 `[VOICE]` 开头，圆桌会把这条回复渲染成语音消息。生成完成后页面显示音频条，文字会收在“转写”按钮后面。

语音生成需要在 `.env` 里配置：

```dotenv
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_CODEX=your_codex_voice_id_here
ELEVENLABS_VOICE_CLAUDE=your_claude_voice_id_here
```

如果没有配置 key 或 voice id，语音消息会自动退回成普通文字，不会卡在“生成语音中”。

### New Codex / New Claude

页面上的新 runtime 按钮会给 Codex 或 Claude 换一个新的 runtime 线程。

这不会删掉当前房间内容。新线程下次发言前，系统会给它：

- fresh runtime handoff
- 最近一段聊天
- 当前 topic 可用的摘要上下文

所以它的含义接近：

> 同一个圆桌话题，换一个新的 Codex 或 Claude 线程继续。

## 常用命令

启动服务：

```powershell
npm run roundtable
```

监听服务状态：

```powershell
npm run roundtable:open
```

五分钟后叫醒 Codex：

```powershell
npm run roundtable:checkin -- codex 5
```

五分钟后叫醒 Claude：

```powershell
npm run roundtable:checkin -- claude 5
```

做语法检查：

```powershell
npm run check
```

跑测试：

```powershell
npm test
```

仓库里还有两个 Windows 便捷脚本：

```powershell
npm run roundtable:with-checkin
npm run roundtable:no-checkin
```

它们会使用端口 `8797`，并带当前 Windows Claude 命令设置。换机器时，先确认脚本里的 Claude 命令路径能用。

## 配置

项目根目录可以放 `.env`。服务启动时会读它。

key、token、命令路径这类内容放 `.env` 合适。`.env` 已被 Git 忽略。

可以从模板开始：

```powershell
Copy-Item .env.example .env
```

### 说明书模板

仓库里已经带了两份圆桌说明书模板：

- `templates/roundtable-codex-instructions.md`：Codex 醒来时读取的说明书。
- `templates/roundtable-claude-instructions.md`：Claude Code 醒来时读取的说明书。

默认会自动读取这两份文件。想换成自己的说明书时，可以在 `.env` 里指定：

```dotenv
ROUNDTABLE_CODEX_INSTRUCTIONS_FILE=templates/roundtable-codex-instructions.md
ROUNDTABLE_CLAUDE_INSTRUCTIONS_FILE=templates/roundtable-claude-instructions.md
```

如果想把说明书放在别的地方，也可以写绝对路径。说明书里不要放 API key、token 或不能公开的私人信息。

### 常用环境变量

| 变量 | 用途 | 默认值 |
| --- | --- | --- |
| `ROUNDTABLE_PORT` | HTTP 端口 | `8787` |
| `ROUNDTABLE_HOST` | HTTP 监听 host | `0.0.0.0` |
| `ROUNDTABLE_STATE_DIR` | 本地状态目录 | `%USERPROFILE%\.cyberboss-roundtable` |
| `ROUNDTABLE_DB_PATH` | SQLite 数据库路径 | `<state dir>\roundtable\roundtable.db` |
| `ROUNDTABLE_WORKSPACE_ROOT` | AI runtime 使用的工作区 | 当前工作目录 |
| `ROUNDTABLE_CODEX_COMMAND` | Codex 命令路径 | runtime 默认值 |
| `ROUNDTABLE_CLAUDE_COMMAND` | Claude Code 命令路径 | 自动探测 |
| `ROUNDTABLE_CODEX_INSTRUCTIONS_FILE` | Codex 说明书路径 | `templates/roundtable-codex-instructions.md` |
| `ROUNDTABLE_CLAUDE_INSTRUCTIONS_FILE` | Claude Code 说明书路径 | `templates/roundtable-claude-instructions.md` |
| `ROUNDTABLE_CHECKIN_ENABLED` | 是否开启 check-in | `true` |
| `ROUNDTABLE_CHECKIN_MIN_INTERVAL_MS` | check-in 最短随机间隔 | `600000` |
| `ROUNDTABLE_CHECKIN_MAX_INTERVAL_MS` | check-in 最长随机间隔 | `3600000` |
| `AUTO_SUMMARY_THRESHOLD` | 自动摘要消息阈值 | `30` |
| `DEEPSEEK_API_KEY` | DeepSeek key | 无 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址 | `https://api.deepseek.com` |
| `GEMINI_API_KEY` | Gemini 摘要备用 key | 无 |
| `ELEVENLABS_API_KEY` | `[VOICE]` 语音生成 key | 无 |
| `ELEVENLABS_VOICE_CODEX` | Codex 语音 voice id | 无 |
| `ELEVENLABS_VOICE_CLAUDE` | Claude Code 语音 voice id | 无 |
| `OLLAMA_BASE_URL` | embedding 服务地址 | `http://localhost:11434` |
| `EMBEDDING_MODEL` | embedding 模型名 | `bge-m3` |

`.env` 例子：

```dotenv
ROUNDTABLE_PORT=8797
ROUNDTABLE_CHECKIN_ENABLED=true
ROUNDTABLE_CODEX_INSTRUCTIONS_FILE=templates/roundtable-codex-instructions.md
ROUNDTABLE_CLAUDE_INSTRUCTIONS_FILE=templates/roundtable-claude-instructions.md
DEEPSEEK_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
ELEVENLABS_API_KEY=your_key_here
ELEVENLABS_VOICE_CODEX=your_codex_voice_id_here
ELEVENLABS_VOICE_CLAUDE=your_claude_voice_id_here
```

不要把 key、token、`.env`、私人记忆、本地 runtime 状态提交进 Git。

## 数据存在哪里

默认状态根目录：

```text
%USERPROFILE%\.cyberboss-roundtable
```

主数据库：

```text
%USERPROFILE%\.cyberboss-roundtable\roundtable\roundtable.db
```

数据库保存：

- topic 和房间绑定
- 消息和附件元数据
- runtime 事件
- 审批记录
- Codex / Claude 的已读位置
- 摘要
- check-in
- runtime session 绑定
- 学习追踪数据

## 常见问题

### 页面打不开

先看启动服务的终端有没有报错，再确认浏览器地址和端口。

默认地址：

```text
http://127.0.0.1:8787
```

### 端口被占用

换端口：

```powershell
$env:ROUNDTABLE_PORT='8798'
npm run roundtable
```

也可以结束占用该端口的旧服务。

### Codex 或 Claude 不回话

先查这几项：

1. 对应 CLI 是否安装。
2. 对应命令路径是否能执行。
3. 自动探测失败时，`ROUNDTABLE_CODEX_COMMAND` 或 `ROUNDTABLE_CLAUDE_COMMAND` 是否写对。
4. 状态面板是否显示在等审批。

### Summary 失败

摘要至少需要一个 provider key：

- `DEEPSEEK_API_KEY`
- `GEMINI_API_KEY`

DeepSeek 网络路径需要备用地址时，设置 `DEEPSEEK_BASE_URL`。

### 服务在 AI 干活时重启

正在跑的 turn 会被中断。服务恢复 state 时会把中断的 pending work 标出来。服务回来后，重新发起后续任务。

## 代码地图

| 路径 | 作用 |
| --- | --- |
| `src/app/roundtable-server.js` | HTTP 服务、topic 调度、runtime prompt |
| `src/app/roundtable-store.js` | SQLite store |
| `src/app/roundtable-runtime.js` | Codex / Claude runtime 协调 |
| `src/app/roundtable-summary.js` | 摘要生成与存储 |
| `src/app/roundtable-checkin.js` | check-in 调度与解析 |
| `src/adapters/runtime/codex/` | Codex runtime adapter |
| `src/adapters/runtime/claudecode/` | Claude Code runtime adapter |
| `public/roundtable/` | 浏览器界面 |
| `templates/` | Codex / Claude 圆桌指令模板 |
| `test/` | 回归测试 |

想继续看维护细节，再读 [PROJECT_GUIDE.md](./PROJECT_GUIDE.md)。
