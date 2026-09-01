# 配置说明

- `model.name`：执行结构化抽取的模型 ID。
- `model.max_output_tokens`：结构化对象通常较短；过高只会扩大最坏成本。
- `input.max_characters`：进入模型前的硬边界，避免无意上传整份日志。
- `prompt.template_file`：Jinja2 Prompt；缺失变量会用 StrictUndefined 立即失败。

`cost_first` 适合字段少、文本短的批量抽取；`quality_first` 允许更长输入和输出，但仍应由评测数据证明收益。
