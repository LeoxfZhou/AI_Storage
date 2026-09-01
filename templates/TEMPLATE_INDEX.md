# 模板检索索引

| 编号 | 模板 | 适合场景 | 核心能力 | 难度 |
|---|---|---|---|---|
| 01 | `llm_api_basics` | 摘要、改写、问答、内容生成 | Responses API、流式输出、重试 | 入门 |
| 02 | `prompt_and_structured_output` | 信息抽取、分类、工单解析 | Prompt 模板、Pydantic、结构化输出 | 入门 |
| 03 | `conversation_memory` | 客服、助手、多轮问答 | `previous_response_id`、本地 Session | 中级 |
| 04 | `rag_knowledge_base` | 企业知识库、文档问答 | Chunk、Embedding、检索、引用 | 中级 |
| 05 | `tool_calling_workflow` | 查天气、查订单、创建工单 | Function Calling、审批、循环上限 | 中级 |
| 06 | `agent_orchestration` | 多领域助手、复杂任务分流 | Router、Handoff、Guardrail、Tracing | 中高级 |
| 07 | `evaluation_observability` | Prompt/模型版本比较、上线回归 | JSONL、Grader、成本与延迟 | 中高级 |
| 08 | `fastapi_production_service` | 内部 API、微服务、容器部署 | FastAPI、异步、Docker、CI | 中高级 |

## 按需求选择

- “输出必须进入数据库”：先看 02，而不是直接解析自由文本。
- “回答只能基于公司资料”：先看 04，并把引用完整性作为评测项。
- “模型需要执行动作”：先看 05；有多个专业角色再看 06。
- “Prompt 改了但不知道是否更好”：先看 07。
- “Demo 要交给前端或其他服务”：最后用 08 包装。

## 不在首版的专题

微调 (Fine-tuning)、多模态 (Multimodal)、语音 (Voice) 和 MCP 留作第二阶段。它们应在掌握结构化输出、工具安全和评测之后学习。
