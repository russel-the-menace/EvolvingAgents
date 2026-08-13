# MindClone

MindClone 是一个长期学习的个人智能体。它把外部知识、用户观点、个人经历和说话方式分开建模，再按当前场景组合成“像本人、本人愿意说、并且没有编造经历”的回答。面试是第一验收场景，不是最终产品边界。

每场面试先录入 JD 和本次投递的准确简历。系统生成一个 `writeBack=false` 的场景快照：简历在本场面试内优先，但不会反向改写长期身份。外部材料自动进入“已理解、仅用于推理”；只有经过讨论与认同后，系统才新建一条用户所有的个人观点，原始外部知识的所有权保持不变。

默认首页是日常对话：DeepSeek 负责自然交流，完整会话、来源、认知状态、授权记录、场景快照和回答审计保存在本地 SQLite。每轮结束后，系统异步提取可能值得保留的认知，不打断聊天。

正式面试是独立模式：它使用本地模型、冻结 JD 与投递简历，并支持可取消的流式候选回答。语音与正式记忆检索将在相同架构上增加。

## 运行

```bash
npm install
npm run desktop
```

在仓库根目录运行命令。开发服务器固定为 `http://127.0.0.1:5269/`。

`npm run dev` 会同时启动网页端和只监听本机的认知 API（`127.0.0.1:5270`）。在“认知库”中可导入 ChatGPT `conversations.json`、粘贴文本/Markdown、学习短视频语音或保存访谈记录。旧版 `data/memory-store.json` 会一次性迁移到 `data/mindclone.sqlite`，原文件不会被删除。

验证命令：

```bash
npm test
npm run check
npm run build
```

## 本地视频转写

短视频导入使用 TiKHub 解析抖音分享文案，并在本机下载临时媒体、提取音频和运行 Whisper。视频画面不会被分析，临时媒体和 WAV 会在转写结束后删除。首次配置：

```bash
brew install ffmpeg whisper-cpp
mkdir -p apps/mind-clone/models/whisper
curl -fL -o apps/mind-clone/models/whisper/ggml-small.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

在 `apps/mind-clone/.env` 设置 `TIKHUB_API_KEY`；模型默认位于 `apps/mind-clone/models/whisper/ggml-small.bin`，可通过 `WHISPER_MODEL_PATH` 和 `WHISPER_THREADS` 覆盖。模型目录和 `.env` 均不纳入 Git。

## 模型

默认连接 Ollama 的 OpenAI 兼容接口 `http://127.0.0.1:11434/v1`。M1 Pro 16GB 的第一轮延迟测试以量化 Qwen 7B 指令模型为基线；模型服务与名称可在应用的“模型设置”中替换。

## JD2Resume 参考项目

`JD2Resume` 不是 MindClone 的依赖或源码副本，而是可随时刷新、不会被提交的参考缓存。执行：

```bash
npm run sync:mind-clone-reference
```

它会从 `https://github.com/russel-the-menace/JD2Resume` 的 `master` 分支快进同步到本应用的 `reference-project`。详见 [参考同步说明](docs/reference-sync.md)。

## 可复用学习引擎

领域无关的来源、分块、命题、证据、检索和引用能力已抽到 [`packages/learning-engine`](../../packages/learning-engine)。MindClone 通过人格认知适配器使用它；CampusAtlas 通过发布机构、有效期和访问权限策略使用同一引擎。爬虫、Cookie、文档解析和回答 UI 不属于该包。

## 设计文档

- [总体架构](docs/architecture.md)
- [桌面工作台](docs/modules/desktop-workbench.md)
- [面试引擎](docs/modules/interview-engine.md)
- [记忆投喂与审核](docs/modules/memory-ingestion.md)
- [云端整理提供方](docs/modules/cloud-preparation.md)
- [日常对话](docs/modules/daily-conversation.md)
- [论文第一版](docs/paper/MindClone_manuscript.md)
- [文献新颖性审计](docs/paper/MindClone_novelty_audit.md)
- [研究论文语料](research-papers/README.md)
- [参考记忆系统](docs/reference-memory-systems.md)
- [学习引擎抽离评估](../../docs/learning-engine-extraction-assessment.md)
