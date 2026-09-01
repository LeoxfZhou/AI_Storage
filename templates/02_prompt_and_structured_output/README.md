# 02 · Prompt 与结构化输出模板

## 项目目标

把一段客服文本稳定转换为 `SupportTicket`，演示 Prompt 模板、Pydantic Schema 和 OpenAI Structured Outputs。适合信息抽取、分类和写入数据库前的标准化；不适合让自由文本正则表达式“猜”字段。

## 执行流程

```text
原始文本 -> 长度校验 -> Jinja Prompt -> StructuredExtractor
        -> SupportTicket Pydantic 校验 -> JSON
```

Schema 是应用合同，不是 Prompt 装饰。即使 Provider 声称返回结构化数据，进入业务层后仍保留类型校验。

## 运行

```bash
uv sync
export OPENAI_API_KEY="your-key"
uv run python -m structured_output_app.main "昨天扣费两次，请退款"
uv run pytest
```

优先修改 `src/structured_output_app/schemas.py` 中标注 `CUSTOMIZE` 的业务字段，然后同步修改 Prompt、评测集和模型卡。
