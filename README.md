# Agent Island · Windows 灵动岛

一个安静的 Windows 顶部通知中心。黑色胶囊在智能体工作时显示起伏波形，回答完成后自动展示答案 2 秒再收起；不抢当前应用的输入焦点。

## 使用

1. 打开 `release/Agent-Island-1.3.0-x64-Portable.exe`，或运行 `release/Agent-Island-1.3.0-x64-Setup.exe` 安装。
2. 空闲时灵动岛隐藏。点击系统托盘中的 Agent Island 图标打开通知中心，再点击右上角设置；也可右键托盘图标选择设置。
3. 勾选 **Codex CLI**、**Claude Code**。首次开启 Codex 时不会导入旧回答，请在开启后提交新问题。
4. 回答过程中显示波形；完成后自动展开 2 秒再收起。点击胶囊直接显示完整答案，不需要再次点击某条通知。
5. 每条答案支持复制。只有顶部有清空按钮，点击立即清空全部通知，没有确认弹窗。

### 1.2 紧凑样式与直接阅读

参考本机 OrcaTerm 灵动岛实测：收起时为 120 × 40 逻辑像素（125% 缩放下是 150 × 50 屏幕像素），纯黑、无品牌文字和厚阴影。运行时显示 12 根高低错落、错峰起伏的波形，右侧圆形数字表示保留的通知总数。展开宽度 480 逻辑像素；空列表仅高 64 像素，随内容自然增高，长答案通过统一滚动区域阅读。保留已有接入、设置和通知数据。

不再区分已读与未读，查看不会减少计数，只有主动清空才会移除通知。旧版通知无论之前是否读过都会保留。清空不会删除 Codex / Claude 的原始会话，也不会因重复完成事件或重启重新出现。

1.3 起胶囊不再常驻：只有未清理通知或正在运行的智能体任务才会自动显示；没有通知、没有运行中任务时隐藏，监听仍在后台继续。清空最后一条通知且没有运行任务时立即隐藏；若还有任务则继续显示。失败、中断、超时状态本身不会让胶囊常驻，可从托盘查看。通过托盘主动打开的通知中心或设置允许在空闲时临时显示，点击外部或按 Esc 收起后隐藏。新答案自动展示 2 秒；在此期间点击或滚动内容会转为手动阅读，不再自动关闭。手动阅读或修改设置时，新答案不会打断当前页面。程序默认静音，不开机启动；设置中可开启这些选项、切换显示器、调整顶部间距、减少动画。

**发送测试通知** 会模拟两个智能体，分别在 3.5 秒和 5.5 秒后完成。测试消息标有“测试”，不代表真实模型回答。

## 接入说明

### Codex CLI

- 自动定位 `CODEX_HOME/sessions`；未设置环境变量时使用用户目录下 `.codex/sessions`，也可在设置中选择。
- 支持交互式 CLI 与 `codex exec`；监听本地 JSONL 中的 `task_started` / `task_complete`，从 `last_agent_message` 或最终回答消息读取文本。
- 不读取思考内容作为通知，不将中间回复、工具输出、子智能体完成计为答案。
- 每两秒扫描增量内容，通常在事件写盘后的两秒内更新。首次开启只记录当前文件末尾，退出后保留读取位置；重启可补收离线期间的新完成事件。关闭后重新开启则重新建立基线，不补收关闭期间的旧通知。
- 日志属于版本相关实现，已针对 CLI `0.153.4` 核实。CLI 更新后若字段变化，需要更新适配器；无法读取时设置里会提示异常。
- 会话持久化必须开启，`codex exec --ephemeral` 不受支持。

### Claude Code

- 自动定位 `CLAUDE_CONFIG_DIR`，否则使用 `.claude`。更改配置目录前先关闭 Claude 开关。
- 开启时将观察用 PowerShell 脚本复制到应用数据目录，备份并合并 Claude `settings.json`，添加 `UserPromptSubmit`、`Stop`、`StopFailure`、`SessionEnd`、`Notification` 和 `PostToolUse` 钩子。
- 钩子只把结构化事件写入本机队列，不输出对话内容、不阻止回答或审批，异常也以成功状态退出。运行中事件使用异步命令；结束事件短暂等待本地写入（上限 3 秒），避免 `claude -p` 退出时杀掉尚未完成的异步通知。应用退出时钩子仍可投递事件，重新打开会补收。
- 使用 `Stop.last_assistant_message`，不依赖可能尚未落盘的 transcript。旧 Claude 版本缺少这个字段时显示“状态待确认”，不会把中间输出伪装成最终答案。
- 已有 CLI 会话可能需要重启才能加载新 hooks。`--bare`、`--safe-mode`、`disableAllHooks`、企业策略或覆盖 hook 的项目配置可能阻止接入；需要在 CLI 侧启用通知钩子。
- 取消勾选仅移除带本程序专属脚本标识的钩子，保留其他设置和命令。备份位于原配置旁的 `settings.json.agent-island-时间戳.bak`。
- `Stop` 表示一轮回答停止，不承诺用户的整个工作目标已完成；用户直接中断未必产生 Stop，应用会通过会话结束或无活动超时显示状态提示，不生成假完成通知。其他 Stop 钩子若要求继续工作，可能改变 CLI 的最终停止时机。

没有新活动超过 10 分钟的任务显示“状态待确认”，而非持续播放波形；后续活动可恢复运行态。错误和中断在列表中有独立状态提示，可手动移除。

## 数据与安全

- 通知、设置和去重信息存放在 `%APPDATA%/Agent Island/state.json`，钩子事件暂存于同目录的 `events`。成功处理并持久化后删除队列事件。
- 所有数据保存在当前电脑，不调用任何模型 API，不需要填写密钥，不依赖 MySQL / Redis，不采集麦克风。
- Markdown 禁用原始 HTML 和远程图片；只允许通过系统浏览器打开 HTTP(S) / mailto 链接。渲染进程启用沙箱和上下文隔离，不开放 Node.js。
- 退出或卸载前可先关闭 Claude 开关以移除通知钩子。默认保留通知数据，便于重新安装后恢复。
- 支持 Windows 10/11 x64 的本地 CLI；首版不支持 WSL、SSH、浏览器对话或独占全屏应用覆盖。
- 安装包未做商业代码签名，Windows 可能显示发行者未知。便携版的通知数据仍存放在当前用户应用数据目录，并非随 EXE 移动。

## 开发

需要 Node.js 22.12+（或较新的 Node.js 24）与 npm。项目独立，不修改上一级小程序。

```powershell
npm ci
npm start           # 编译并打开 Electron
npm run dev        # 浏览器预览，只有标明测试的模拟数据
npm test           # 核心状态、日志和配置测试
npm run build
npm run test:desktop
node scripts/window-smoke.mjs
npm run pack       # 构建 Windows x64 安装版和便携版
```

首次安装会下载 Electron。若下载中断，运行 `npx install-electron` 后重试。图标由 `scripts/generate-icons.mjs` 在构建时生成，不依赖外部图片或字体。

目录：`electron` 是本地事件接入、存储与窗口；`src` 是 React 界面；`shared` 是 IPC 类型；`resources` 是观察钩子与应用图标。

`scripts/desktop-smoke.mjs`、`scripts/window-smoke.mjs` 使用独立临时应用目录，覆盖真实 Electron 窗口、两种来源的事件、波形高低变化、2 秒自动展示、阅读计数保持、复制/一键清空/重启、透明边角、焦点和缩放。截图和结果写入 `output/playwright`。

`node scripts/live-cli-smoke.mjs` 是可选的真实 CLI 集成检查，会对已安装的两个 CLI 各发起一个短请求，可能消耗现有账户额度。可通过 `AGENT_ISLAND_CODEX_ENTRY`、`AGENT_ISLAND_CLAUDE_EXE` 指定 CLI 路径；不修改全局 hook 配置，不记录凭据。API 不可用时，与本地通知通道是否正常分开报告。

接口依据：[Claude hooks 文档](https://code.claude.com/docs/en/hooks)、[Electron 窗口文档](https://www.electronjs.org/docs/latest/api/browser-window)。Codex 字段依据本机 CLI 会话结构验证。
