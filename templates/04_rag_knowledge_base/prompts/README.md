# Prompt 说明

模板变量为 `question` 和 `hits`。证据在 Prompt 中有稳定 Chunk ID；生成结果使用结构化 `RagAnswer`，Pipeline 会过滤不在命中集合里的引用。
