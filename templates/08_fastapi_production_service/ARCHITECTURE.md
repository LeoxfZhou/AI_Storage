# 架构与请求流

```text
HTTP -> Request ID middleware -> Pydantic ChatRequest
     -> dependency get_service() -> ChatService
     -> AsyncTextProvider -> OpenAI Responses API
     -> ChatResponse / mapped HTTP error
```

`app.py` 不在 import 时读取 API Key，因此健康检查和测试不依赖外部服务。真实请求第一次解析依赖时才创建 Provider。测试通过 `dependency_overrides` 注入 Fake Service。
