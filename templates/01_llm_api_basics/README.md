# 01 · LLM API 基础模板

## 项目目标

这个模板演示一次文本生成请求从“用户输入”到“OpenAI Responses API 输出”的完整路径，重点学习配置、Provider 隔离、超时、重试和流式输出。

适合摘要、改写、问答和内容草稿。不适合需要外部知识、工具副作用或严格 JSON 的任务；这些场景分别参考 04、05、02。

## 执行流程

```text
CLI input
 -> load_config()
 -> BasicLLMService.generate()
 -> OpenAIResponsesProvider.generate()/stream()
 -> GenerationResult
```

入口只处理命令行，Service 只编排业务，Provider 只理解 OpenAI SDK。默认测试向 Service 注入 Fake Provider，因此不会联网。

## 模型与参数

- 生成模型说明：`models/generation_model/README.md`
- 完整参数说明：`configs/README.md`
- Prompt：`prompts/system.md`

`temperature` 默认为 `null`，Provider 不会发送它。这样不会假设所有模型都支持同一组采样参数。

## 运行

```bash
uv sync
export OPENAI_API_KEY="your-key"
uv run python -m llm_api_basics.main "请用三句话解释 RAG"
uv run python -m llm_api_basics.main --stream "写一个学习计划"
uv run pytest
```

## 常见故障

- `OPENAI_API_KEY is required`：没有导出环境变量。
- `ValidationError`：YAML 的类型或范围不符合 `AppConfig`。
- 超时/限流：先检查请求大小和账户限制，再谨慎增加重试；重试不能修复永久性参数错误。
