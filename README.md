# MindClone

MindClone 是一个本地优先的面试演练工作台。每场面试先录入 JD 和本次投递简历，生成并确认一份冻结的面试包；确认后才进入低延迟的正式问答。

默认首页是日常对话：DeepSeek 负责自然交流，完整会话和记忆归属在本地。每轮结束后，系统会异步判断该轮是否值得形成待审核记忆，不打断聊天。单一可收起侧栏提供本地对话搜索、会话删除和单条消息删除；输入框旁的 `+` 用于导入 ChatGPT 历史或补充文本/Markdown。

正式面试是独立模式：它使用本地模型、冻结 JD 与投递简历，并支持可取消的流式候选回答。语音与正式记忆检索将在相同架构上增加。

## 运行

```bash
npm install
npm run desktop
```

开发服务器固定为 `http://127.0.0.1:5269/`。只启动网页调试界面可运行 `npm run dev`。

`npm run dev` 会同时启动网页端和只监听本机的记忆 API（`127.0.0.1:5270`）。在“记忆投喂”中可导入 ChatGPT `conversations.json`、粘贴文本/Markdown，或保存访谈记录；点击整理后才会将单份材料发送给 DeepSeek，候选记忆必须人工确认。

## 本地视频转写

短视频导入使用 TiKHub 解析抖音分享文案，并在本机下载临时媒体、提取音频和运行 Whisper。视频画面不会被分析，临时媒体和 WAV 会在转写结束后删除。首次配置：

```bash
brew install ffmpeg whisper-cpp
mkdir -p models/whisper
curl -fL -o models/whisper/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

在 `.env` 设置 `TIKHUB_API_KEY`；模型默认位于 `models/whisper/ggml-small.bin`，可通过 `WHISPER_MODEL_PATH` 和 `WHISPER_THREADS` 覆盖。模型目录和 `.env` 均不纳入 Git。

## 模型

默认连接 Ollama 的 OpenAI 兼容接口 `http://127.0.0.1:11434/v1`。M1 Pro 16GB 的第一轮延迟测试以量化 Qwen 7B 指令模型为基线；模型服务与名称可在应用的“模型设置”中替换。

## JD2Resume 参考项目

`JD2Resume` 不是 MindClone 的依赖或源码副本，而是可随时刷新、不会被提交的参考缓存。执行：

```bash
npm run sync:reference
```

它会从 `https://github.com/russel-the-menace/JD2Resume` 的 `master` 分支快进同步。详见 [参考同步说明](docs/reference-sync.md)。

## 设计文档

- [总体架构](docs/architecture.md)
- [桌面工作台](docs/modules/desktop-workbench.md)
- [面试引擎](docs/modules/interview-engine.md)
- [记忆投喂与审核](docs/modules/memory-ingestion.md)
- [云端整理提供方](docs/modules/cloud-preparation.md)
- [日常对话](docs/modules/daily-conversation.md)
