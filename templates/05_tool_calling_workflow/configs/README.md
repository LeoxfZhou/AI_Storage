# 配置说明

- `workflow.max_tool_rounds`：模型和工具往返上限；提高会允许复杂任务，也扩大费用和循环风险。
- `workflow.parallel_tool_calls`：示例默认 false，简化有副作用工具的顺序控制。
- `model.max_output_tokens`：最终回答和中间模型输出上限。

成本预设限制为一轮工具；质量预设允许四轮，但不是越高越好。业务流程复杂时优先写确定性 Workflow，而不是无限增加 Agent 自由度。
