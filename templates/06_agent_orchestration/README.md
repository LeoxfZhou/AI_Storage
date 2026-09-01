# 06 · Agent 编排模板

## 项目目标

演示一个 Triage Agent 在账单与技术支持 Agent 之间 Handoff，并在调用 Agent SDK 前执行确定性输入 Guardrail。适合职责明确的多领域助手；如果一个确定性函数就能完成任务，不要为了“像 Agent”而增加编排。

## 执行流程

```text
input -> LocalInputGuardrail
      -> triage_agent
      -> billing_agent OR technical_agent (Handoff)
      -> AgentResult(final_output, last_agent)
      -> trace
```

Handoff 表示专业 Agent 接管剩余对话；如果希望中央 Agent 始终整合最终答案，应改用 Agents as Tools 模式。

## 运行

```bash
uv sync
export OPENAI_API_KEY="your-key"
uv run python -m agent_orchestration.main "我的会员被重复扣费"
uv run pytest
```
