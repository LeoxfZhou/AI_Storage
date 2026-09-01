# 学习笔记

## Handoff 与 Agents as Tools

Handoff 后专业 Agent 成为当前回答者，适合职责切换。Agents as Tools 由 Manager 保持控制，适合汇总多个专家。先决定“谁拥有最终答案”，再选模式。

## 为什么 Router Prompt 要短

Router 的目标是可靠分类，不是展示知识。给它太多专业内容会诱使它直接作答，降低 Handoff 可观测性。

## Tracing 的隐私

Trace 能记录模型、工具和 Handoff，便于调试，但可能含用户输入。上线前必须核对敏感数据记录策略，不能默认把完整生产数据发送到追踪系统。
