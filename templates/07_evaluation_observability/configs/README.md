# 配置说明

- `evaluation.case_file`：一行一个 `EvalCase` 的 JSONL。
- `evaluation.output_file`：逐例 Trace，可能含用户内容，需按数据等级保护。
- `evaluation.pass_threshold`：单例最低分；硬安全规则可额外一票否决。
- `pricing.*_per_million_tokens`：仅用于估算，必须人工维护生效日期。
- `model.max_output_tokens`：候选模型输出上限。

预设可以改变样本子集和输出上限，但比较两个候选版本时必须固定同一数据集与 Grader。
