# 08 · FastAPI 生产服务模板

## 项目目标

把文本生成能力包装为异步 HTTP API，包含强类型请求/响应、健康检查、依赖注入、请求 ID、受控错误、Docker Compose 和 GitHub Actions。

它是生产化起点，不是完整生产平台。真实上线还需公司统一鉴权、限流、密钥管理、日志平台、指标、Tracing、网络策略和发布流程。

## API

- `GET /health`：不调用模型，用于容器存活检查。
- `POST /v1/chat`：校验输入后调用异步 Provider。
- `X-Request-ID`：客户端可传入；缺失时服务生成，响应始终返回。

## 运行

```bash
uv sync
export OPENAI_API_KEY="your-key"
uv run uvicorn production_service.app:app --reload
curl http://localhost:8000/health
uv run pytest
```

容器运行：

```bash
cp .env.example .env
docker compose up --build
```
