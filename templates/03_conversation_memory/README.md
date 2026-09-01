# 03 · 多轮会话与记忆模板

## 项目目标

演示如何使用 `previous_response_id` 续接 OpenAI Responses API，同时把会话 ID、最近消息和响应 ID 保存到本地 JSON。适合客服和个人助手；不适合把“长期用户画像”无限塞进上下文。

## 两种状态不要混淆

- Provider 会话链：`previous_response_id` 让下一次请求接着上一次响应。
- 应用业务状态：本地 `SessionStore` 保存用户可见消息、审计信息和最新响应 ID。

删除本地历史不会自动删除 Provider 侧数据；真实项目要根据数据政策选择 `store`、保留期和删除流程。

## 运行

```bash
uv sync
export OPENAI_API_KEY="your-key"
uv run python -m conversation_memory.main --session demo "我叫小周"
uv run python -m conversation_memory.main --session demo "我刚才说我叫什么？"
uv run pytest
```
