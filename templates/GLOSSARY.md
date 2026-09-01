# 大模型应用工程术语表

- 大语言模型 (Large Language Model, LLM)：根据上下文生成或理解内容的模型。
- 提示词 (Prompt)：发送给模型的指令、背景、示例和输出约束。
- 结构化输出 (Structured Output)：满足 JSON Schema 或类型模型的输出。
- 工具调用 (Tool Calling)：模型提出函数调用意图，由应用实际执行函数。
- 检索增强生成 (Retrieval-Augmented Generation, RAG)：先检索证据，再让模型基于证据回答。
- 嵌入 (Embedding)：把文本映射为向量，用于相似度检索。
- 重排 (Reranking)：对初步召回结果进行二次相关性排序。
- 会话状态 (Conversation State)：跨多轮请求保留的消息、响应 ID 或业务状态。
- 护栏 (Guardrail)：在输入、工具或输出边界执行的校验与阻断规则。
- 移交 (Handoff)：把当前任务控制权转给更合适的 Agent。
- 追踪 (Tracing)：记录模型调用、工具调用、Handoff、耗时和错误的执行链。
- 评测器 (Grader)：对模型输出进行规则、相似度或模型评分的组件。
- 幻觉 (Hallucination)：输出看似合理但没有依据或与事实冲突的内容。
- 回归测试 (Regression Test)：验证修改后原来正确的能力没有退化。
