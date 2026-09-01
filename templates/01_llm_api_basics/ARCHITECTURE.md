# 架构与数据流

`main.py` 是边界层；它读取 CLI 和文件。`config.py` 将松散的 YAML 变成强类型配置。`service.py` 构造请求并决定同步或流式路径。`providers/openai_provider.py` 将内部 Schema 翻译为 OpenAI SDK 参数。

依赖方向固定为：入口依赖 Service，Service 依赖 Protocol 和 Schema，具体 Provider 实现 Protocol。业务层不导入 OpenAI SDK，因此测试和换 Provider 都不需要改业务规则。
