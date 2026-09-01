# 教学型代码注释规范

## 三类统一标签

- `CUSTOMIZE`：复制模板后通常需要修改的业务点。
- `WHY`：解释无法从代码表面看出的设计原因。
- `FAILURE MODE`：说明已防御的失败以及移除防御的后果。

```python
# CUSTOMIZE: 把这里替换为公司的工单系统，而不是把业务逻辑塞进 Agent。
ticket = ticket_gateway.create(payload)

# WHY: 先校验参数再执行工具，避免模型生成的未知字段进入有副作用的系统。
arguments = CreateTicketArgs.model_validate(raw_arguments)

# FAILURE MODE: 工具循环必须有限制，否则模型反复调用失败工具会持续产生费用。
if round_index >= config.max_tool_rounds:
    raise ToolLoopLimitError(config.max_tool_rounds)
```

## 文件和函数

- 模块 Docstring 说明它在执行链中的上游和下游。
- 公共函数写 `Args`、`Returns`、`Raises`。
- 注释解释“为什么”和“可能出什么问题”，不翻译显而易见的语法。
- 大段教学解释写入 `LEARNING_NOTES.md`，保持生产代码可读。
