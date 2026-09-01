# 配置说明

| 参数 | 类型/范围 | 默认值 | 影响 |
|---|---|---:|---|
| `model.name` | string | `gpt-5.4-mini` | 模型能力、价格和延迟；使用前核对账户可用性 |
| `model.max_output_tokens` | 1..32768 | 800 | 越大允许输出越长，也提高最坏成本 |
| `model.temperature` | null 或 0..2 | null | 越高越发散；不要和 `top_p` 同时调 |
| `model.timeout_seconds` | 1..300 | 30 | 太短会误杀慢请求，太长会拖慢故障恢复 |
| `model.max_retries` | 0..5 | 2 | 只适合暂时性网络或限流错误 |
| `prompt.system_file` | path | `prompts/system.md` | System Prompt 文件 |

预设只覆盖少量字段。复制项目后先从 `balanced.yaml` 开始，记录评测结果后再选择成本或质量预设。
