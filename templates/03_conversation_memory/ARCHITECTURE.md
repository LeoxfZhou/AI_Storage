# 架构与状态流

```text
session_id -> SessionStore.load()
           -> ConversationService.chat()
           -> provider.reply(previous_response_id)
           -> append Turn + update response_id
           -> trim local audit history
           -> atomic SessionStore.save()
```

`max_local_turns` 只控制本地保留的展示/审计消息，不会裁剪已经在 Provider 会话链中的内容。长会话应增加摘要或 compaction 策略，而不是误以为删本地 JSON 就缩短了模型上下文。
