# 架构与控制权

`OrchestrationService` 管输入安全和统一结果；`OpenAIAgentsRunner` 创建 SDK Agent 图；三个 Prompt 分别定义路由与专业职责。路由 Agent 不应回答专业问题，只选择合适 Handoff。

本地 Guardrail 只示范长度和明显 Prompt Injection 检测，不是完整安全产品。生产环境应组合身份、内容政策、数据权限、输入/输出 Guardrail 和工具审批。
