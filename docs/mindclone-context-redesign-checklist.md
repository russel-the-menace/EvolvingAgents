# MindClone Context Redesign Checklist

这份清单用于把 MindClone 从“有限 top-k RAG 聊天”重构为“完整原始历史 + 可回溯认知索引 + 场景化低延迟回答”。

## 目标和不可妥协约束

- [ ] 完整日常聊天原文永久保存在 SQLite；任何 prompt 截断都不得删除或覆盖原文。
- [ ] 原始对话、导入文档、正式面试 transcript 都是一级 source/evidence。
- [ ] claim 只负责索引、结构化认知、权限和授权，不替代原文。
- [ ] 每个注入模型的摘要、claim、证据都能回溯到 source、message 或 evidence offset。
- [ ] 每次回答记录实际使用的 sources、evidence、claims、summaries、context budget 和截断原因。
- [ ] top-k 只是上下文编排策略之一，不能是系统唯一记忆机制。
- [ ] 日常对话允许异步学习和较慢模型；正式回答使用预编译 scene 和本地模型，不能等待学习流程。
- [ ] scene-local 身份不能写回长期身份；模型生成的回答默认不能自动成为用户经历或观点。
- [ ] 删除源消息时，必须可追踪删除其派生 source/evidence/claim，或留下明确 tombstone。

## 0. 基线和保护网

- [ ] 在修改前运行 `npm test`，记录当前通过数量和 Node 版本。
- [ ] 新增一个端到端 fixture：同一 session 至少 40 条 user/assistant 消息，消息中包含只在第 2、20、40 条出现的事实。
- [ ] 新增断言：历史 API 返回 40 条完整消息。
- [ ] 新增断言：上下文编排器能够回溯第 2 条消息，不因 recent window 丢失。
- [ ] 新增断言：正式回答 scene 的 resume 事实不会写回长期 claims。
- [ ] 新增断言：模型回答的每个 context item 都带 source/evidence 引用。
- [ ] 将当前 `slice(-24)`、固定 `limit: 12/20/24`、`slice(0, 60000)` 全部登记为待迁移点，不在重构过程中继续复制。

## 1. 先修正数据模型：原文成为一级资料

### 1.1 SQLite schema

- [ ] 在 `apps/mind-clone/server/infrastructure/database.mjs` 的初始化 schema 中确认 `sessions`、`messages`、`sources`、`evidence_units` 的外键关系。
- [ ] 给 `sources` 增加 `source_scope`，取值至少包括 `daily_conversation`、`imported_document`、`formal_scene`、`formal_transcript`。
- [ ] 给 `sources` 增加 `parent_source_id`，用于把 conversation-turn source、scene transcript 和派生摘要连回母 source。
- [ ] 给 `evidence_units` 增加 `message_id`，允许 evidence 精确指向原始聊天消息。
- [ ] 给 `evidence_units` 增加 `start_offset`、`end_offset` 的强制一致性检查；无法精确定位时使用明确的 `offsetPrecision=chunk`。
- [ ] 新增 `context_summaries` 表：`id`、`scope_type`、`scope_id`、`summary_type`、`content`、`source_ids_json`、`evidence_ids_json`、`covered_from`、`covered_to`、`version`、`created_at`、`superseded_at`。
- [ ] 新增 `context_summary_links` 表：summary 到 source/evidence/message/claim 的可审计关系。
- [ ] 新增 `context_runs` 表：`id`、`session_id`、`scene_id`、`question`、`strategy`、`budget_chars`、`used_chars`、`items_json`、`omitted_json`、`created_at`。
- [ ] 新增 `context_run_items` 表：`run_id`、`item_type`、`item_id`、`source_id`、`evidence_id`、`ordinal`、`selection_reason`、`char_count`。
- [ ] 用幂等 migration 处理旧数据库，不删除旧表，不覆盖旧 source 内容。
- [ ] 为每个新表增加 repository 的 typed mapper 和最小 CRUD，不在 route 中直接拼 SQL。

### 1.2 原始对话保存路径

- [ ] 在 `apps/mind-clone/server/infrastructure/database.mjs` 的 `addMessage()` 中保持完整 message body，不做 prompt 级截断。
- [ ] 在 `apps/mind-clone/server/index.mjs` 的 daily chat 写入路径中，确保 user message 在模型调用前保存，assistant message 在模型完成后保存。
- [ ] 为每个 daily turn 创建或更新一个 `daily_conversation` source，内容包含完整有序 transcript；不要只保存可学习的那一句。
- [ ] 为 source 记录 session id、message ids、时间范围和当前版本，便于从摘要/claim回溯。
- [ ] 删除消息时同步处理关联的 turn source、evidence 和派生 claim；保留 source tombstone，避免后台任务重新抽取已删除内容。
- [ ] 给导入 ChatGPT history 保留原始 JSON/文本 source，不只保存抽取后的 claims。

## 2. 建立统一 Context Compiler

### 2.1 新模块

- [ ] 新建 `apps/mind-clone/server/domain/context-compiler.mjs`。
- [ ] 导出 `compileDailyContext({ session, question, store, policy, budget, now })`。
- [ ] 导出 `compileSceneContext({ scene, question, store, policy, budget, now })`。
- [ ] 导出 `recordContextRun({ store, run, items })`。
- [ ] 导出 `resolveContextItem(item, store)`，从 claim/summary/evidence/source 还原可读内容。

### 2.2 Context item 类型

- [ ] 定义 `recent_messages`：当前会话最近消息，保留完整 message id 和时间。
- [ ] 定义 `conversation_summary`：覆盖指定历史区间的递归摘要。
- [ ] 定义 `retrieved_claim`：结构化 claim，必须带 claim id 和 authorization。
- [ ] 定义 `source_evidence`：原文证据片段，必须带 source id、message id 或 offset。
- [ ] 定义 `expression_sample`：用户表达样本，只能来自 user-owned source。
- [ ] 定义 `scene_fact`：当前 scene 的 JD、resume 和明确授权事实。
- [ ] 每种 item 都提供 `text`、`provenance`、`authority`、`charCount` 和 `selectionReason`。

### 2.3 分层策略

- [ ] 先取当前 session 的连续上下文；不得默认只取固定 24 条而不说明覆盖范围。
- [ ] 检查当前 session 是否存在覆盖更早消息的 summary；不存在时从原文构建。
- [ ] 根据 query 从 claims 检索候选，但先保留 claim 的 evidence 和 source，不只返回 proposition。
- [ ] 对高置信、需要第一人称的 personal claim 强制附带原文证据。
- [ ] 对 external knowledge 默认附带 source title 和 evidence，不允许只注入无来源摘要。
- [ ] 在预算内优先加入：当前话题原文、用户自己的表达、冲突/过期信息、授权相关证据。
- [ ] 预算不足时按层级降级：原文 evidence -> 已有可回溯 summary -> claim index；不得静默丢弃。
- [ ] 记录所有被省略的候选及原因：预算不足、权限不符、过期、低相关性、冲突未确认。
- [ ] 支持 `strategy: full`、`strategy: hierarchical`、`strategy: retrieval` 三种模式；默认由预算和模型能力决定。

### 2.4 摘要生成

- [ ] 新建 `apps/mind-clone/server/domain/context-summarization.mjs`。
- [ ] 只对原文区间生成 summary，summary 必须记录覆盖的 message/source 范围。
- [ ] 摘要 prompt 要求保留时间、说话者、确定性、冲突、原话引用锚点和未解决问题。
- [ ] 摘要不得把 external/third_party 内容改写成 user experience。
- [ ] 使用版本号和 superseded_at 替换旧摘要，不原地覆盖历史摘要。
- [ ] 为摘要建立“摘要 -> evidence”链接，并在回答 context 中可展开回原文。
- [ ] 提供按 session、主题和时间范围重建摘要的任务入口。

## 3. 改造 Learning Engine：从 claim retrieval 到 evidence retrieval

- [ ] 在 `packages/learning-engine/src/retrieval.mjs` 中让检索结果始终携带完整 evidence/source provenance。
- [ ] 新增 `retrieveEvidence()`，返回 claim、evidence、source、score、validity、authorization。
- [ ] 保留 `retrieveKnowledge()` 作为兼容 API，但内部调用 evidence retrieval。
- [ ] 增加 `sourceIds`、`sessionIds`、`sceneId`、`timeRange`、`owner`、`authorizationScope` 过滤器。
- [ ] 增加 `includeOriginal` 选项，按 evidence offset 拉取原文邻域，而不是只返回 quote。
- [ ] 把默认 `limit: 8` 改为显式策略参数，禁止业务代码隐式依赖固定数量。
- [ ] 为中文 query 增加更可靠的 token/bigram 与 source-level FTS 测试。
- [ ] 在已有 FTS 之外预留向量 retriever 和 reranker，但只有加入基准测试后才启用。
- [ ] 增加跨文档/跨对话检索测试，验证同一事实可以从不同 source 聚合并保留每个 provenance。
- [ ] 增加过期、冲突、拒绝 claim 不会重新进入 context 的测试。

## 4. 重构日常对话

### 4.1 Chat runtime

- [ ] 在 `apps/mind-clone/server/index.mjs` 的 `streamDailyChat()` 中移除 `session.messages.slice(-24)`。
- [ ] 改为调用 `compileDailyContext()`，由 compiler 决定 recent messages、summary、evidence 和 budget。
- [ ] 把完整 session id、当前 user message 和 context run id 写入本轮 answer metadata。
- [ ] system prompt 明确要求：引用 context item 的 provenance；不把摘要当作未授权事实；证据不足时说明缺口。
- [ ] assistant 输出完成后，保存完整回答，再触发异步 extraction/summary，不阻塞首字响应。
- [ ] 不允许 assistant 自动成为 user-owned source；模型生成内容只能作为 assistant message 或候选观察。
- [ ] 删除/编辑历史消息时，截断后续对话并使相关 summary/context run 标记 superseded。

### 4.2 日常学习闭环

- [ ] 将每个完整 user/assistant turn 写入 source/evidence 关系。
- [ ] 仅对满足 durable-signal 的 turn 异步提取候选 claim。
- [ ] 候选 claim 保存 source evidence 和原始 message id。
- [ ] 用户批准前维持 `observed/none`，不能进入 personal experience context。
- [ ] 用户讨论、确认或应用后，创建独立 user-owned derived claim，并保留 `internalized_as` 关系。
- [ ] 冲突观点进入 inquiry queue，不能由最新摘要静默覆盖旧观点。
- [ ] 提供“回答用了哪些历史”API，返回 context run 和可展开原文。

### 4.3 Daily API 和前端

- [ ] 在 `apps/mind-clone/src/memory-api.ts` 增加 `getContextRun(runId)`。
- [ ] 在 `apps/mind-clone/src/types.ts` 增加 `ContextItem`、`ContextRun`、`ProvenanceRef` 类型。
- [ ] 在 daily message 上支持“查看来源/查看原文”操作，先实现文本列表，不做复杂可视化。
- [ ] 在 session 列表和搜索中读取数据库全量历史，不使用前端分页作为删除式截断。
- [ ] 加入加载旧消息和按时间跳转能力，避免一次性渲染超长 transcript。

## 5. 重构正式回答模式

### 5.1 Scene 编译

- [ ] 保留 `apps/mind-clone/server/domain/scenes.mjs` 的 scene-local/non-write-back 约束。
- [ ] 把 `slice(0, 10)`、`slice(0, 8)`、`slice(0, 6)` 改为由 scene context budget 和授权策略决定。
- [ ] scene snapshot 保存 claim ids、source ids、evidence ids、summary ids，而不只保存 claim JSON。
- [ ] exact resume 和 JD 作为 scene source/evidence 保存，记录来源和提交时间。
- [ ] scene snapshot 记录 context policy、模型、预算、编译版本和创建时间。
- [ ] scene 编译不能把外部 claim 升级成 user experience。

### 5.2 每个正式问题

- [ ] `/api/scenes/:id/plan` 先调用 `compileSceneContext()`，再生成 answer plan。
- [ ] plan 同时返回 knowledge evidence、personal evidence、expression samples 和 provenance。
- [ ] 对第一人称句子强制要求 personal evidence 或 scene resume 证据。
- [ ] 对外部知识要求 attribution，不允许只传 proposition。
- [ ] 将本次 plan、context run、最终 answer 和 audit 绑定到同一个 answer run。
- [ ] formal transcript 的 interviewer/candidate 消息全部持久化到 `formal_transcript` source。
- [ ] generated candidate answer 默认不进入 user memory；只有用户明确确认并提供理由时才创建 user-owned derived claim。
- [ ] 保留跨问题的正式对话上下文，但超过预算时使用 scene transcript summary，不直接静默删除旧问题。

### 5.3 本地模型边界

- [ ] 将正式模型 gateway 配置独立为 `LOCAL_MODEL_BASE_URL`、`LOCAL_MODEL_NAME` 等变量。
- [ ] 在 `apps/mind-clone/server/index.mjs` 中禁止 formal endpoint 使用默认远程 gateway fallback。
- [ ] 缺少本地模型时返回明确错误，不发送 JD、resume、transcript 或 personal evidence 到云端。
- [ ] 为 model gateway 增加请求目的标签：`daily_chat`、`background_extract`、`formal_answer`。
- [ ] 测试 formal request 的 endpoint、provider 和 payload 不会走 daily/cloud provider。

## 6. Notebook/domain 层（在上下文底座稳定后做）

- [ ] 新建 `notebooks` 表：id、title、description、owner、created_at、updated_at、archived_at。
- [ ] 新建 `notebook_sources` 表：notebook_id、source_id、role、ordinal、added_at。
- [ ] 新建 `notebook_sessions` 表：notebook_id、session_id、mode、created_at。
- [ ] 给所有 retrieve/summary/context API 增加 `notebookId` 可选过滤。
- [ ] Notebook 不复制 source content，只建立 source 关系。
- [ ] Notebook 页面支持创建、重命名、归档、添加/移除 source、打开 daily chat。
- [ ] Notebook chat 使用同一 Context Compiler，不另写一套 RAG。
- [ ] Notebook 回答显示引用 source、原文片段和 context run。
- [ ] 暂不把 Notebook 当作个人长期身份；Notebook 只是资料范围和任务上下文容器。

## 7. 可观测性和质量验收

- [ ] 每次回答记录输入 token/字符估算、context item 数、source 数、evidence 数、summary 数和丢弃数。
- [ ] 记录首 token 延迟、完整回答延迟、后台 extraction 延迟和 summary 延迟。
- [ ] 建立“历史覆盖率”指标：回答所需事实所在的旧消息是否可被召回。
- [ ] 建立“引用完整率”：每个事实性 context item 是否有 source/evidence。
- [ ] 建立“身份越权率”：外部/第三方 evidence 是否被生成成第一人称。
- [ ] 建立“场景泄漏率”：formal resume 事实是否出现在 scene 外的 daily context。
- [ ] 建立“摘要损失测试”：摘要后能否回答原文中的时间、否定、条件和冲突。
- [ ] 建立长历史 benchmark：100、1,000、10,000 条消息，测试召回、延迟和预算降级。
- [ ] 建立跨 session benchmark：同一事实在不同日期、不同主题中出现时能否正确合并 provenance。
- [ ] 所有性能优化都必须通过 benchmark 后才改变默认策略。

## 8. 推荐实现顺序

按以下顺序执行，不要先做 UI Notebook：

1. [ ] 基线测试、数据库 migration 和原文 source/evidence 关系。
2. [ ] Context item 类型、Context Compiler 和 context run 审计。
3. [ ] Learning Engine evidence retrieval 与 provenance 回溯。
4. [ ] 日常对话移除 24 条硬截断，接入分层 context compiler。
5. [ ] 日常摘要、异步 extraction、删除/编辑后的 supersede 处理。
6. [ ] 正式 scene 保存 evidence/source 引用，接入 scene context compiler。
7. [ ] 正式 transcript 持久化、answer run 与 audit 关联。
8. [ ] 强制 formal local-model endpoint，补 privacy regression tests。
9. [ ] 长历史、摘要损失、引用完整性和身份安全 benchmark。
10. [ ] 最后实现 Notebook 容器、source 绑定和 Notebook UI。

## 完成定义

- [ ] 删除 `slice(-24)` 后，任意旧消息仍可通过 Context Compiler 进入回答上下文或被明确记录为未选中原因。
- [ ] 任意 claim、summary 或 answer plan 都能一跳或多跳回到原始 source/evidence。
- [ ] 任意回答都能通过 context run 展示“用了什么、没用什么、为什么”。
- [ ] 日常模式能够持续积累认知，不因模型 prompt 预算而丢失原始历史。
- [ ] 正式模式能够在本地模型下秒级响应，并保持 scene-local 身份边界。
- [ ] 正式回答 transcript 被完整保留，但不会自动污染长期用户身份。
- [ ] 通过长历史、摘要损失、来源回溯、删除重建、权限隔离和场景泄漏测试。
