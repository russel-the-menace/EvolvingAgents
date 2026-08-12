# MindClone

MindClone 是一个本地优先的面试演练工作台。每场面试先录入 JD 和本次投递简历，生成并确认一份冻结的面试包；确认后才进入低延迟的正式问答。

当前实现包括面试包准备、正式会话、流式本地模型接口和可取消生成。语音、异步投喂和记忆审核将在相同架构上增加，正式面试链路不调用云端整理。

## 运行

```bash
npm install
npm run desktop
```

开发服务器固定为 `http://127.0.0.1:5269/`。只启动网页调试界面可运行 `npm run dev`。

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
