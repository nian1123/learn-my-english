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

应用默认可连接本地 OpenAI 兼容接口 `http://localhost:51448/v1`，也支持 DeepSeek 作为回退。在 `.env.local` 中填写对应的模型和密钥即可：

```dotenv
OPENAI_BASE_URL=http://localhost:51448/v1
OPENAI_API_KEY=
OPENAI_MODEL=

DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=
```

两套 AI 都未配置时，学习库仍可正常打开。服务端诊断只返回连接状态，不会把密钥发送给浏览器。

## 字幕获取边界

Study Video 始终通过 YouTube 官方 IFrame Player API 播放，应用不会下载、代理、缓存或托管视频与音频。自动字幕获取可尝试使用 `yt-dlp`，但可靠回退始终是学习者提供的 Caption Source（`.vtt` 或 `.srt` 格式）。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

端到端测试会启动真实的生产应用，仅以本地测试服务替换词典和 `yt-dlp` 等外部边界。
