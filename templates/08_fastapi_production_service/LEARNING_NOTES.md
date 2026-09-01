# 学习笔记

## async 不等于自动更快

异步让 Worker 在等待网络时处理其他请求，但 CPU 密集任务仍会阻塞事件循环。Provider 必须使用 `AsyncOpenAI`，不能在 async endpoint 中调用同步 SDK。

## 健康检查为什么不调模型

把外部模型调用放进 liveness 会在 Provider 故障时重启全部实例，放大事故。可另建 readiness 或依赖探测，但要清楚其发布语义。

## 错误为什么不返回原始异常

SDK 异常可能包含内部细节。API 给客户端稳定错误码和 Request ID，完整异常只进入受控服务端日志。
