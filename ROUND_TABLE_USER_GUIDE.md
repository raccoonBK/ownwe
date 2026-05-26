# Cyberboss Roundtable 使用说明书


本说明不写异世界旅社，也不写学习计划区。

可以上传图片及文件，语音功能也加了，但是需要 ElevenLabs API key。

## 1. 先理解圆桌是什么

圆桌可以想成一个家里有很多房间的聊天工作台。

```text
圆桌
  ├─ 主厅：大家都能说话
  ├─ 固定房间：长期存在的主题房间
  ├─ 项目房间：一个项目一直在这里推进
  ├─ 临时房间：一段临时讨论，用完可以归档
  ├─ Codex 单聊：只和 Codex 说
  └─ Claude 单聊：只和 Claude 说
```

每个房间都有自己的聊天记录、总结、搜索结果、AI 已读位置和 AI 线程。你在主厅说过的事，不会自动变成学习房间或某个项目房间的上下文。

## 2. 三位 AI 分别怎么用

| AI | 你可以怎么理解 |
| --- | --- |
| Codex | 有自己的本地私人记忆 |
| Claude Code | 有自己的云端记忆衔接；可以通过 MCP 接入群聊 |
| DeepSeek | 手动叫来的，不会自己随机醒来 |

| 你想做什么 | 选择 |
| --- | --- |
| 让圆桌自然接话 | `Round` | 默认 Codex 先说话，然后 Claude |
| 只记录一句，不让 AI 回复 | `只发送` |
| 明确叫 Codex | `@Codex` |
| 明确叫 Claude | `@Claude` |
| 明确叫 DeepSeek | `@DeepSeek` |

## 3. 页面怎么读

圆桌页面大概分成三块：

```text
左侧：房间和搜索
中间：当前房间聊天
右/上方按钮：换实例、总结、结束、审批、发送目标
```

可以这样看：

```text
┌──────────────────────┬──────────────────────────────┐
│ 左侧导航              │ 当前房间                      │
│                      │                              │
│ 搜索                  │ 房间名 / 状态                 │
│ 单聊                  │ 聊天记录                      │
│ 固定房间              │ 审批提醒                      │
│ 项目                  │ 输入框                        │
│ 临时房间              │ Round / @Codex / @Claude      │
└──────────────────────┴──────────────────────────────┘
```

手机上左侧导航会收起来，顶部的按钮会变少，有些操作会藏在 `⋯` 里。

## 4. 左侧每一块是什么意思

| 区域 | 用法 |
| --- | --- |
| 搜索框 | 搜过去的聊天和总结 |
| 单聊 | 进入 Codex 或 Claude 的私人对话房间 |
| 固定房间 | 长期房间，比如主厅、哲学圆桌、无人圆桌，外加两个可自定义的固定房间 |
| 项目 | 长期项目，每个项目有自己的上下文 |
| 最近 | 临时房间和最近打开的话题 |

## 5. 房间应该怎么选

### 主厅

适合随手聊天、让大家一起参与、临时讲一个想法。

### Codex 单聊

适合只想跟 Codex 说的话。

Codex 单聊不会被 Claude 当成自己的单聊记录随便搜到。

### Claude 单聊

适合只想跟 Claude Code 说的话。

Claude 单聊不会被 Codex 当成自己的单聊记录随便搜到。

注意单聊时选对 @ 人，不然就会把另一个人叫来。

### 固定房间

适合长期反复回来的主题。比如主厅、哲学圆桌、无人圆桌。

另外还有两个可自定义的固定房间（`slot1` / `slot2`）。你可以在顶部面板改它们的名字和图标。

固定房间的意义是不用每次重新解释"这里是干嘛的"。

### 项目房间

适合任何要长期推进的事情。项目房间有固定的图标（根据标题自动分配）。

项目名称可以在顶部面板重命名。

### 临时房间

适合一段短讨论。

临时房间用完可以保留，也可以结束后当作历史。临时房间可以归档（点 `收` 按钮），归档后在左侧会隐藏，但可以在话题抽屉的"已归档"分组里找到并恢复。

## 6. 新建房间时怎么想

点 `话题` 按钮后，你会看到新建面板。

你只需要决定一件事：

| 问题 | 怎么选 |
| --- | --- |
| 这件事以后还会回来吗 | 会，就建项目；不会，就建临时 |

房间类型在创建时决定，之后不能改变。只能改名。

## 7. 当前房间顶部按钮

| 按钮 | 真正含义 |
| --- | --- |
| `End` | 结束当前话题，把它放回历史里 |
| `↺ Codex` | 当前房间的 Codex 下次换一个新实例 |
| `↺ Claude` | 当前房间的 Claude 下次换一个新实例 |
| `Summary` | 总结当前房间的新内容 |

这里最容易误会的是 `↺`。

`↺ Codex` 不是"叫 Codex 立刻说话"。它是：

```text
这个房间里，下次 Codex 出场时，请用一个新 Codex 线程接手。
```

`↺ Claude` 同理。

## 8. 什么叫"同一个房间永远是那个实例"

圆桌会给每个房间保存 Codex / Claude 的线程绑定。

也就是说：

```text
主厅的 Codex ≠ 项目A的 Codex ≠ Codex 单聊里的 Codex
```

它们可能都是 Codex，但线程和上下文是分开的。

如果你没有点 `↺ Codex`，当前房间就会尽量继续用原来的 Codex 实例。

如果你点了 `↺ Codex`，系统会准备一次 fresh handoff，让新 Codex 接着当前房间继续。

## 9. 发消息的目标怎么选

输入框左边有一个小按钮，默认显示 `Round`。

点开后有：

| 目标 | 什么时候用 |
| --- | --- |
| `Round` | 你想让圆桌自然运转 |
| `只发送` | 你只是补资料，不想让 AI 立刻回答 |
| `@Codex` | 你要 Codex 做事 |
| `@Claude` | 你要 Claude 做事 |
| `@DeepSeek` | 你要 DeepSeek 出来判断或总结 |

## 10. AI 正在忙时，你发消息会怎样

如果 Codex 或 Claude 正在工作，你继续发消息，系统会把你的消息当成补充材料放进当前房间，不会自动打断正在跑的任务。

如果你想打断某个 AI，每个正在运行的 AI 卡片上都有一个独立的 `中断` 按钮。点它就只打断那个人，另一个 AI 不受影响。

此外，你发消息时页面底部会出现一个 `打断并发送` 按钮，点它会中断所有正在运行的 AI 并发送你的消息。

## 11. 审批是什么

有些操作 AI 不能自己直接做，需要你批准。

页面出现审批面板时，你会看到允许或拒绝按钮。

| 你点什么 | 结果 |
| --- | --- |
| 允许 | AI 继续执行这次操作 |
| 拒绝 | AI 停下这次操作 |

不懂就拒绝，然后让 AI 解释。

## 12. Summary 是什么

Summary 是房间的阶段性记忆。

聊天记录很长以后，AI 不应该每次把所有原文都重新读一遍。Summary 就像房间墙上的备忘卡。

你点 `Summary` 时，总结的是当前房间。主厅的 Summary 不会自动变成 Codex 单聊的 Summary。项目 A 的 Summary 也不会自动注入项目 B。

自动 Summary：当前房间新增 30 条消息后自动触发。DeepSeek 优先，Gemini 兜底。

## 13. Summary 面板怎么用

进入"摘要"面板后，你会看到过滤按钮：

| 过滤 | 看什么 |
| --- | --- |
| 当前房间 | 只看这个房间 |
| 项目 | 看项目类总结 |
| 固定 | 看固定房间总结 |
| 单聊 | 看 Codex / Claude 单聊总结 |
| 全部 | 全部总结 |

每张 Summary 卡片上常见按钮：

| 按钮 | 用法 |
| --- | --- |
| `Edit` | 改这条总结 |
| `→ Codex` | 把这条总结注入给 Codex |
| `→ Claude` | 把这条总结注入给 Claude |
| `Hide` | 隐藏这条总结 |
| 选择圆点 | 选中多条，用 DeepSeek 合并 |

`Hide` 不是删除，是软隐藏。

隐藏后，这条 summary 不会再出现在：时间线、搜索、交接注入、语义候选。

如果一条总结写坏了，或者已经被更好的总结替代，就 Hide 它。

## 14. 什么时候该手动总结

适合点 `Summary` 的时候：

| 情况 | 为什么 |
| --- | --- |
| 一段讨论结束 | 给这个房间留一个阶段记忆 |
| 做了重要决定 | 以后可以搜到 |
| 准备换新 Codex / Claude | 新实例接手更稳 |
| 临时房间准备归档 | 保留关键结论 |
| 项目推进了一段 | 留下当前状态 |

不需要每说几句就总结。Summary 应该像"阶段结论"，不是每条消息的复述。

## 15. 搜索怎么用才有效

搜索不是只搜聊天原文，它会同时尝试找：

```text
相关 Summary
相关原文消息
原文前后几条上下文
```

打开方式：

```text
点左侧搜索框
或按 Ctrl + K
```

搜索范围：

| 范围 | 适合搜什么 |
| --- | --- |
| All | 你自己全局找东西 |
| Main | 主厅内容 |
| Codex | Codex 单聊 |
| Claude | Claude 单聊 |
| Project | 某个项目 |
| Temp | 临时话题 |
| Philosophy | 哲学圆桌 |
| Alone | 无人圆桌 |

搜索结果可以点。点了以后会打开对应房间，并跳到原文附近。

## 16. 怎么写搜索词

如果你记不清原文，就搜意思。Summary 搜索有语义向量（通过 bge-m3 本地嵌入），能找"意思接近"的总结。原文消息主要是关键词搜索，所以关键词越具体越好。

## 17. AI 能搜到什么

用户可以搜全量。

AI 有边界保护：

```text
Codex 不能随便搜 Claude 单聊
Claude 不能随便搜 Codex 单聊
```

它们能搜公共房间、项目、临时话题，以及自己的单聊。

## 18. 什么是 handoff

Handoff 就是交接。

当你让一个新 Codex 或新 Claude 接手时，它不能凭空知道旧线程经历了什么，所以系统会给它一份交接材料。

交接大概包含：

```text
固定指南
房间类型
当前房间说明
当前房间 Summary
语义相关的几条旧 Summary
最近几条聊天
当前谁在干活
当前时间
```

你不用手写 handoff。你需要做的是：

```text
重要阶段点 Summary
坏 summary 点 Hide
需要新实例时点 ↺ Codex / ↺ Claude
```

## 19. Check-in 是什么

Check-in 是 AI 自己定时醒来看一眼。

醒来以后，它可以：

| 动作 | 意思 |
| --- | --- |
| silent | 看完但不说话 |
| speak | 说一句 |
| remind_self | 给自己定下一次醒来 |

它醒来时主要看未读内容和一条提示，不是把整个房间从头读一遍。

DeepSeek 不自动 check-in。DeepSeek 是你手动叫的。

## 20. 怎么写自己的 AI 指南

Codex 指南文件：

```text
templates\roundtable-codex-instructions.md
```

Claude 指南文件：

```text
templates\roundtable-claude-instructions.md
```

你可以直接编辑它们。

## 21. 改完指南怎么让 AI 生效

改完指南后，最稳的做法：

```text
保存指南
回到页面
点 ↺ Codex 或 ↺ Claude
再让它说话
```

因为新 runtime 线程开始时会读指南。

如果你不点 `↺`，旧线程可能还在沿用之前的上下文。

## 22. 便签和归档怎么用

便签/归档（Storage）适合保存"你明确想留在台面上的结论"。

比如：

```text
Summary 隐藏是软隐藏，不进入搜索和注入。
DeepSeek 不自动醒来，只手动叫。
```

它在左侧的 Storage / Notebook 面板里，不走聊天流。

## 23. 附加功能

### 上传图片和文件

输入框旁边有附件按钮，可以传图片和文件。图片会在聊天里直接显示，文件会作为可下载的链接。

### 语音消息

如果配置了 ElevenLabs API key，Codex 和 Claude 的消息可以语音播放。消息前加 `[VOICE]` 前缀即可触发语音合成。

### Claude Chat MCP 接入

Claude Chat 可以通过 MCP 桌面协议接入圆桌群聊。它可以：
- 看当前活跃房间和其他房间的聊天记录
- `@` 他们让他们回话
- 通过 `messages_read`、`messages_send`、`messages_wait` 工具参与交流
- 使用 `rooms_list` 查看所有可用房间

## 24. 一个搜索找回过去的流程

你记得以前说过"summary 隐藏不会删除"，但忘了在哪：

```text
1. 按 Ctrl + K
2. 范围选 All
3. 搜 summary 隐藏
4. 先看 Summary 结果
5. 需要原话就点消息结果跳回原文
```

如果搜不到，换成：

```text
Hide summary
隐藏 总结 搜索 注入
软隐藏
```

## 25. 最容易混淆的点

### `End` 不是删除

`End` 是结束当前话题，让它进入历史。它不是把聊天记录清空。

### `Hide` 不是物理删除

`Hide` 是隐藏 summary，让它不再参与时间线、搜索和注入。

### `↺ Codex` 不是立刻叫 Codex

它只是让下次 Codex 用新实例接手。

### `只发送` 不会叫 AI

它只是把你的话记到房间。

### 单聊不是公共房间

Codex 单聊和 Claude 单聊有边界。用户能搜全量，AI 不能互相随便搜对方单聊。

### `中断` 只打断一个人

每个运行中的 AI 卡片上有独立的 `中断` 按钮，只打断那个人，不会影响另一个。

### 房间类型创建后不能改

临时房间和项目房间在创建时就定了。之后只能改名字，不能从临时变成固定、从项目降级成临时。

## 26. 代码对照

这部分只是给你确认说明书没有乱写。不会代码也可以跳过。

| 说明书内容 | 对照文件 |
| --- | --- |
| 页面按钮和面板 | `public/roundtable/index.html` |
| 前端状态和交互逻辑 | `public/roundtable/app.js` |
| 发消息目标 | `public/roundtable/app.js` 的 `submitUserMessage`、`targetButtons` |
| 房间、单聊、项目打开 | `/api/open-room`、`/api/open-direct`、`/api/open-project` |
| 后端 API 接口 | `src/app/roundtable-server.js` |
| 固定房间和单聊默认定义 | `src/app/roundtable-state.js` 的 `DEFAULT_FIXED_ROOMS`、`DEFAULT_DIRECT_CHATS` |
| Summary 面板逻辑 | `public/roundtable/app.js` 的 Summary 相关函数 |
| Summary 存储和搜索 | `src/app/roundtable-summary.js` |
| 记忆搜索权限 | `src/app/roundtable-memory-search.js` |
| 消息搜索和上下文 | `src/app/roundtable-store.js` |
| 每房间 runtime 绑定 | `src/app/roundtable-runtime.js` |
| 新 Codex / 新 Claude | `src/app/roundtable-server.js` 的 `startFreshRuntime` |
| AI 指南加载 | `src/adapters/runtime/shared-instructions.js` |
| Codex 私人记忆 | `src/mcp/codex-private-memory-server.js` |
| 审批流程 | `src/app/roundtable-approval.js` |
| Check-in 巡房 | `src/app/roundtable-checkin.js` |
| 附件上传 | `src/app/roundtable-upload.js` |
| 语音合成 | `src/app/roundtable-tts.js` |
| MCP 桌面接入 | `src/desktop-mcp-server.js` |
| 数据库结构 | `migrations/001_init.sql` 及后续迁移文件 |