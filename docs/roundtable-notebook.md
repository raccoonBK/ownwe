# 圆桌本子

这个本子记录圆桌当前规则、待办和 bug。它给人看，也给 AI 开工前核对用。

使用规则：
- 完成的项目直接打勾。
- 备注只写稳定模块、函数名或排查方向，不写行号。
- 不确定的、bug、想法先放收件箱。
- 确定要做但此刻不处理的内容，放对应目标的待完成。
- 修好的 bug 放对应目标的 Bug 区，方便后续查看。
- 每次改代码后，把对应条目的结果写回这里。

## [ ] 目标：上下文和提示词

### 现在规则
- [ ] AI 开工前先看当前话题、收件箱和对应卡片。

### 待完成
- [ ] 梳理 Codex / Claude / check-in / 单聊 / 项目 / 固定房间的提示词拼接顺序。
- [ ] 确认提示词是否工具化，哪些场景共用，哪些场景单独处理。
- [ ] 明确每次醒来读取的系统指令、圆桌指令、消息、摘要、本子、附件、记忆和工具说明。

### Bug
- [ ] 暂无。

### 备注
- 相关模块：`templates/roundtable-*-instructions.md`；`src/adapters/runtime/shared-instructions.js`；`src/app/roundtable-server.js` 的 `buildRuntimePrompt` 和 check-in 上下文。

## [ ] 目标：话题和房间

### 现在规则
- [ ] 新建只能创建临时话题和项目话题；创建后系统自动给 AI 上下文里的话题名加上临时或固定前缀，主页显示去掉前缀后的名字。
- [ ] 话题框显示固定话题和已经归档过的话题；新建话题没有归档过时不会出现在话题框。
- [ ] 临时话题和项目话题可以从主页收进话题框，也可以从话题框恢复到主页或彻底删除；删除会清理话题、聊天记录、事件、摘要和绑定。
- [ ] 固定房间和单聊不能删除，也不能归档。
- [ ] 临时话题、项目话题和两个自定义固定话题支持改名；后续话题名只能通过改名入口修改，改名后同步更新话题名。

### 待完成
- [ ] 后续彻底移除固定旅社话题和旅社界面。
- [ ] 改名后增加明确反馈，不再需要切换页面确认名字是否变化。

### Bug
- 暂无。

### 备注
- 相关模块：`public/roundtable/app.js` 的话题弹层、侧栏渲染、项目渲染。
- 相关模块：`src/app/roundtable-state.js` 的房间和话题绑定。
- 相关模块：`src/app/roundtable-server.js` 的打开房间、改名、删除和归档接口。

## [ ] 目标：搜索

### 现在规则
- [x] 搜索结果点击后可以跳转到原消息位置。

### 待完成
- [ ] 梳理消息搜索、记忆搜索、范围筛选和项目/房间限定。

### Bug
- [ ] 暂无。

### 备注
- 若再次出问题，优先核对搜索结果点击处理、消息渲染 key、滚动定位和高亮逻辑。

## [ ] 目标：总结和注入

### 现在规则
- [ ] 摘要不出现在聊天区。
- [ ] 摘要支持手动新增、手动合并。
- [ ] 摘要支持注入给指定 AI，让该 AI 下次回复时看到。

### 待完成
- [ ] 暂无。

### Bug
- [ ] 暂无。

### 备注
- 相关模块：`public/roundtable/app.js` 的 summary timeline 和 summary injection；`src/app/roundtable-summary.js` 的摘要新增、合并、搜索、注入上下文。

## [ ] 目标：数据和持久化

### 现在规则
- [x] 本子数据存 SQLite app_meta JSON blob，不新建表。`/api/notebook` 读写；`docs/roundtable-notebook.md` 作为人类可读版本，不参与运行时同步。

### 待完成
- [x] 圆桌本子做成页面里的常驻区域，取代散落在聊天里的待办。
- [ ] 梳理消息、附件、runtime session、摘要、本子和迁移的重启恢复路径。
- [ ] 核对旧数据兼容逻辑，特别是旧 notebook decisions 字段迁移。

### Bug
- [ ] 暂无。

### 备注
- 相关模块：`src/app/roundtable-store.js`；`src/app/roundtable-server.js` 的 notebook API；`migrations`；SQLite `app_meta`。

## [ ] 目标：工作状态和报错日志

### 现在规则
- [ ] 上方工作状态里的单个 AI 中断按钮保留，只中断对应 AI。
- [x] Claude Code 空 result 时用 assistant 文本兜底，避免误报 returned no reply text。

### 待完成
- [ ] 聊天输入框旁的中断按钮语义重新确定，并在界面上写清楚。
- [ ] 梳理运行状态、pending 消息、超时、错误展示和重试路径。

### Bug
- [ ] 空输入时点击聊天框中断曾经没有反馈，需要核对当前行为。
- [ ] 状态可能显示还在回复，但没有可中断的 active runtime。
- [ ] 曾出现多次 `claude returned no reply text`，需要重启服务后验证是否消失。

### 备注
- 相关模块：`public/roundtable/app.js` 的 `submitUserMessage`、工作状态按钮、输入框按钮；`src/app/roundtable-server.js` 的 runtime run、`interruptSpeaker`、`pauseAutoRun`；`src/app/roundtable-runtime.js`；`src/adapters/runtime/claudecode`。

## [ ] 目标：语音

### 现在规则
- [ ] 暂无。

### 待完成
- [ ] 梳理语音消息、转录、TTS、voiceOnly、音频链接和失败兜底。
- [ ] 核对语音消息在聊天区、历史记录和手机端的显示。

### Bug
- [ ] 暂无。

### 备注
- 相关模块：`src/app/roundtable-tts.js`；`src/app/roundtable-upload.js`；消息 voice 字段和 audio_url。

## [ ] 目标：外出可用

### 现在规则
- [ ] 暂无。

### 待完成
- [ ] 核对手机局域网访问、PWA、页面刷新和弱网表现。
- [ ] 核对外出时附件上传、图片查看和长消息输入体验。

### Bug
- [ ] 暂无。

### 备注
- 相关模块：`public/roundtable/manifest.webmanifest`；`sw.js`；roundtable-server 静态资源和上传接口。

## 收件箱
- [ ] 新发现的 bug 先写这里，再归到某个项目和目标。
- [ ] 理清房间和话题：6 个固定房间是否都支持改名。
- [ ] 理清房间和话题：项目是否允许删除。
- [ ] 理清房间和话题：旧的临时/固定降级或类型转换逻辑是否删除。
- [ ] 理清房间和话题：异世旅社房间和旅社界面是否保留。
- [ ] 理清中断行为：聊天输入框中断按钮是否保留“带消息打断”的语义。
- [ ] 理清中断行为：是否增加纯停止按钮，只停止当前 AI 或本轮，不发送新消息。
