# 配置说明

- `agents.model`：三个 Agent 的默认模型；真实项目可给 Router 和专家分别配置。
- `agents.max_turns`：Agent SDK 运行轮数上限，防止路由或工具循环。
- `guardrail.max_input_characters`：进入 Agent 前的硬长度边界。
- `tracing.workflow_name`：在 Trace 中聚合同一业务流程。

成本预设减少轮数和输出，质量预设允许更长专家回答。不要用提高 `max_turns` 掩盖错误的 Handoff 图。
