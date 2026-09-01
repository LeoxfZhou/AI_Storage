# 配置说明

- `server.host` / `port`：本地监听；生产由容器和平台覆盖。
- `server.request_timeout_seconds`：传给 OpenAI Async Client。
- `input.max_characters`：HTTP 边界层输入上限。
- `model.max_output_tokens`：单请求最大输出。
- `model.max_retries`：SDK 暂时性错误重试次数。

配置文件不保存 Key。部署差异通过 Secret/环境变量注入，YAML 保存非敏感业务参数。
