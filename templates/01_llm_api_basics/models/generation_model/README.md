# generation_model 模型卡

- Provider：OpenAI
- 默认 Model ID：`gpt-5.4-mini`
- 本项目角色：通用文本生成
- 最后检查日期：2026-09-01

## 适用场景

模板使用它演示常见 Responses API 请求。默认模型只是学习起点，不表示它永远是成本或质量最优选择。

## 本项目参数

模型 ID、最大输出 Token、超时与重试都在 `configs/default.yaml`。`temperature` 为 `null` 时不发送，避免把不支持的可选参数硬塞给模型。

## 替换检查表

更新 YAML 后核对新模型是否支持流式输出和采样参数；运行单元测试及真实小样本；记录质量、成本、首 Token 延迟和最后检查日期。
