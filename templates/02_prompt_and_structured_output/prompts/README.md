# Prompt 说明

模板只有 `user_text` 一个变量，并启用 `StrictUndefined`。新增变量时必须同时更新 `PromptRenderer.render()`、Prompt 文档与测试，避免生产中静默渲染为空字符串。
