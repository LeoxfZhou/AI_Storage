# 大模型应用工程学习模板库

这个目录不是一个被所有项目共同读取的“中央程序”，而是一组可以单独复制、运行和改造的参考项目。每个编号目录都演示一种大模型应用工程 (LLM Application Engineering) 场景，并且保留完整的配置、模型说明、测试与失败模式。

## 推荐学习顺序

1. `01_llm_api_basics`：理解一次模型请求从配置到输出的完整路径。
2. `02_prompt_and_structured_output`：让自然语言输出变成可验证的数据结构。
3. `03_conversation_memory`：理解多轮状态、历史裁剪和持久化。
4. `04_rag_knowledge_base`：完成摄取、检索、生成和引用闭环。
5. `05_tool_calling_workflow`：让模型在受控边界内调用业务工具。
6. `06_agent_orchestration`：学习路由、Handoff、Guardrail 和追踪。
7. `07_evaluation_observability`：用数据而不是主观感觉比较版本。
8. `08_fastapi_production_service`：把前面的能力包装为可部署服务。

## 正确使用方式

```bash
# 先在 TEMPLATE_INDEX.md 中选择最接近需求的模板。
cp -R templates/04_rag_knowledge_base my_customer_support_rag
cd my_customer_support_rag

# 建立独立环境；也可以把 uv 换成公司规定的包管理器。
uv sync
cp .env.example .env
uv run pytest
```

复制后优先搜索 `CUSTOMIZE`：

```bash
rg "CUSTOMIZE" .
```

这些位置是模板故意暴露的改造点。请先修改项目 `README.md`、`configs/` 和 `models/*/README.md`，再改业务代码。不要直接把真实 API Key 写进 YAML、Python 或 Git 历史。

## 统一执行路径

每个模板都遵循同一个心智模型：

```text
用户输入
  -> CLI / HTTP 入口
  -> 配置与输入校验
  -> Pipeline / Service 业务编排
  -> Provider 适配层
  -> OpenAI API 或测试 Fake
  -> 结构化结果
  -> 日志、评测或 HTTP 响应
```

`Provider` 隔离外部 SDK，`Pipeline` 保存业务规则，`Schema` 定义边界，测试使用 Fake/Mock。这样替换模型厂商时，不需要重写核心业务逻辑。

## 版本说明

- 目标运行时：Python 3.11+。
- 示例以 OpenAI Responses API 和 OpenAI Agents SDK 为主。
- 默认测试不联网、不读取真实密钥、不产生 API 费用。
- 模型能力与参数会变化；实际使用前应核对项目模型卡中的“检查日期”。
