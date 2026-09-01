# 07 · 评测与可观测性模板

## 项目目标

用 JSONL 测试集批量运行候选模型，计算包含/禁止关键词得分、通过率、Token、延迟和估算成本，并把逐例结果写成可审计 JSONL。

这个模板回答的是“版本 B 是否比版本 A 更好”，不是只展示几个漂亮输出。确定性 Grader 适合硬规则；开放式质量可增加模型 Grader，但必须先校准并保留人工复核集。

## 运行

```bash
uv sync
export OPENAI_API_KEY="your-key"
uv run python -m eval_observability.main
uv run pytest
```

默认价格字段为 `0`，避免把会变化的价格伪装成长期事实。真实项目从经过审核的内部价格配置更新，并记录生效日期。
