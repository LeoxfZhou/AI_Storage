# 05 · 工具调用工作流模板

## 项目目标

演示模型提出 Function Calling、应用校验参数、执行受控工具、把结果交回模型的完整循环。示例包含只读天气工具和需要审批的创建工单工具。

关键原则：模型只能“请求调用”，真正执行权永远在应用。参数 Schema、鉴权、审批、超时和循环上限不能交给 Prompt 代替。

## 执行流程

```text
user -> model turn -> ToolCall[]
                    -> ToolRegistry.validate + authorize + execute
                    -> function_call_output[]
                    -> next model turn
                    -> final text / max_tool_rounds error
```

## 运行

```bash
uv sync
export OPENAI_API_KEY="your-key"
uv run python -m tool_workflow.main "上海天气如何？"
uv run python -m tool_workflow.main --approve-side-effects "创建一个登录故障工单"
uv run pytest
```

真实项目必须把 `tools.py` 中示例实现替换成公司 Gateway，并在服务端再次鉴权。
