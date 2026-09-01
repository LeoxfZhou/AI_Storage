# 配置说明

| 参数 | 默认值 | 调节影响 |
|---|---:|---|
| `retrieval.chunk_characters` | 800 | 小块更精确但上下文少；大块相反 |
| `retrieval.chunk_overlap` | 120 | 减少跨边界丢失；过大会重复 |
| `retrieval.top_k` | 4 | 提高 Recall，也增加噪声和 Token |
| `retrieval.min_score` | 0.15 | 提高会更保守，可能出现空结果 |
| `retrieval.lexical_weight` | 0.2 | 专有名词多时可提高，语义问法多时不宜过高 |
| `generation.max_output_tokens` | 1000 | 控制答案上限和成本 |

先固定生成 Prompt，用标注问题调检索；检索稳定后再比较生成模型。不要同时改变 Chunk、Embedding、Reranker 和 Prompt，否则无法判断收益来源。
