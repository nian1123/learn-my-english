# Learn My English

一个本地优先的美式英语听力学习应用。当前版本提供中文学习库界面、运行环境诊断，以及保存在浏览器 IndexedDB 中的学习偏好。

## 本地启动

需要 Node.js 20.9 或更高版本、Google Chrome，以及用于自动字幕获取的 `yt-dlp`。

```bash
npm install
cp .env.example .env.local
npm run dev
```

然后打开 [http://localhost:3000](http://localhost:3000)。点击“设置与诊断”可查看 `yt-dlp`、本地 AI、DeepSeek、基础词典和浏览器本地数据的状态。

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

## 验证

```bash
npm run typecheck
npx playwright install chromium
npm test
npm run build
```

端到端测试会启动真实的生产应用，仅以本地测试服务替换词典和 `yt-dlp` 等外部边界。
