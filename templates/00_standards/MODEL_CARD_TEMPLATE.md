# `<model_role>` 模型卡 (Model Card)

- Provider：`<provider>`
- Model ID：`<model-id>`
- 本项目角色：`<generation / embedding / reranker / guardrail>`
- 最后检查日期：`YYYY-MM-DD`

## 适用场景

说明模型为什么适合当前任务，以及它负责调用链中的哪一步。

## 输入与输出

记录支持的模态、结构化输出、工具调用以及业务侧 Schema。

## 本项目使用参数

| 参数 | 当前值 | 调高/调低影响 | 兼容性注意事项 |
|---|---:|---|---|
| `max_output_tokens` | `<value>` | 控制最大输出与成本 | 包含可见输出和推理 Token |

## 限制与风险

记录上下文限制、知识时效、幻觉、敏感数据、地区和许可要求。

## 替换检查表

- 更新 `configs/*.yaml` 中的模型 ID。
- 核对新模型支持的参数、工具、Schema 与输入模态。
- 运行 `tests/` 和 `evals/`，比较质量、成本与延迟。
- 更新本模型卡的检查日期和评测结果。
