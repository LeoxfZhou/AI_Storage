# 配置说明

- `model.name` / `max_output_tokens`：生成模型与最大输出。
- `memory.store_directory`：本地 Session JSON 目录，不应提交 Git。
- `memory.max_local_turns`：仅限制本地保留的 Turn 数，范围 1..200。
- `memory.store_provider_response`：是否允许 Provider 保存响应以供 ID 续接；设为 false 时需要改用手工历史策略。

成本预设缩短输出和本地历史；质量预设不会自动解决超长上下文，真实项目必须单独设计摘要或 compaction。
