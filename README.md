# Learn My English

一个本地优先的美式英语听力学习应用。粘贴 YouTube URL 后，应用会尝试获取已有英文 Caption Source，也可以在自动获取失败后使用学习者提供的 VTT/SRT，并通过官方 YouTube 嵌入播放器按 Learning Sentence 定位练习。

## 本地启动

需要 Node.js 20.9 或更高版本和 Google Chrome。`yt-dlp` 只用于尝试自动获取公开字幕：它是非官方、可能失效的可选集成，不影响应用启动。

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后打开 [http://localhost:3000](http://localhost:3000)。点击“设置与诊断”可查看 `yt-dlp`、本地 AI、DeepSeek、基础词典和浏览器本地数据的状态。

## 导入第一个 Study Video

1. 在 Study Library 粘贴一个 `youtube.com/watch?v=…` 或 `youtu.be/…` 单视频链接。
2. 点击“开始导入”。应用会读取公开元数据，通过官方 IFrame Player API 检查可嵌入性与时长，然后优先获取人工英文字幕，没有时再获取自动生成的英文字幕。
3. 如果自动获取失败、超时或本机缺少 `yt-dlp`，按界面提示上传有效的 `.vtt` 或 `.srt` Caption Source 继续。

导入过程会显示当前阶段。不可嵌入、不是公开内容、超过 3 小时或 Caption Source 损坏时，应用会用中文说明下一步，并且不会留下半成品 Study Video。

## 可选 AI 配置

应用可连接本地 OpenAI 兼容接口（示例地址为 `http://localhost:51448/v1`）。Base URL、API key 和模型名必须分别显式配置；应用不会猜测模型。DeepSeek 使用独立、同样显式的服务端配置：

```dotenv
OPENAI_BASE_URL=http://localhost:51448/v1
OPENAI_API_KEY=
OPENAI_MODEL=

DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=
```

本地 AI 用于从基础词典义项中选择当前语境，并生成单独标识的辅助例句。只有 Local AI 不可用时，应用才会考虑 DeepSeek；第一次云端回退会先用中文列出将离开设备的最小查询内容并等待明确同意。同意或拒绝保存在当前浏览器，可在“设置与诊断”中查看、撤销或重置。DeepSeek 不会接收其他字幕、Study Library 或学习记录。

中文释义默认关闭，只有学习者打开开关后才会请求。AI 未配置、同意被拒绝、超时、失败或返回无效结构时，Word Lookup 会保留可用的基础词典内容。服务端诊断只返回连接状态；Local AI 和 DeepSeek 密钥都不会进入浏览器、本地备份或 AI 缓存。

有用的最终 Word Lookup 可以保存到 Word Bank。条目会在浏览器中保留词形、所选语境词义、发音、原 Learning Sentence、Study Video 和精确时间区间；即使本地服务停止，已保存的英文内容仍可读取。中文仍默认隐藏。来源 Study Video 仍在学习库时，可从 Word Bank 回到原句并立即播放。

删除 Study Video 时，视频、学习进度和本地修订会一起移除，但 Word Bank 语境默认保留并标记为来源不可用。确认删除时可以选择同时移除只来自该视频的 Word Bank 语境；同一表达在其他 Study Video 中保存的语境不会受到影响。

“设置与诊断”可以导出 schema version 1 的 JSON 备份，覆盖 Study Library、Caption Sources、Learning Sentences、本地修订、学习进度、学习偏好、DeepSeek 同意状态、Word Lookup 缓存和 Word Bank。备份不包含 API 密钥、服务端环境配置或音视频文件。恢复前会完整校验文件；“合并”遇到同一标识但内容不同会停止整个事务，“替换”会原子清空并写入备份，因此无效、不兼容或冲突的文件都不会留下部分修改。

浏览器报告离线时，应用会停止 YouTube 播放、新 Study Video 导入以及未缓存的词典和 AI 请求，并明确显示限制；本地 Study Library、Caption Sources、Learning Sentences、Local Revisions、Word Lookup 缓存和 Word Bank 仍可查看，Local Revision 等本地操作仍可继续。已有缓存总是先于 provider 请求读取，因此 provider 停止后不会遮住已保存内容。

导入始终保留当前处理阶段。等待外部服务超过 30 秒会显示变慢提示；超过 60 秒时会强调取消操作，并在字幕获取阶段允许直接改用本地 VTT/SRT。Caption Source 限制为 10 MB，其时间轴必须位于视频时长内；provider 元数据中的地址也只接受无内嵌凭据的 HTTP(S) URL。取消、离线中断、provider 失败、无效响应和保存失败都不会创建部分 Study Video。

## 字幕获取边界

Study Video 始终通过 YouTube 官方 IFrame Player API 播放，应用不会下载、代理、缓存或托管视频与音频。自动字幕获取可尝试使用 `yt-dlp`，但可靠回退始终是学习者提供的 Caption Source（`.vtt` 或 `.srt` 格式）。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

端到端测试会启动真实的生产应用，仅以本地测试服务替换词典和 `yt-dlp` 等外部边界。
