# 学习笔记

## 为什么保存最新 Response ID

下一轮只需把最新 `previous_response_id` 交给 API，不必把本地历史重新拼成字符串。指令不会由 `previous_response_id` 自动继承，因此模板每轮都显式传入 instructions。

## 为什么写临时文件再替换

进程在写 JSON 中途崩溃会留下半个文件。`SessionStore.save()` 先写同目录临时文件再 `replace`，使最终文件切换尽量原子化。

## 并发限制

此教学版本没有跨进程锁。同一个 Session 被多个 Worker 同时更新时可能发生最后写入覆盖；生产环境应换成带事务或乐观锁的数据库。
