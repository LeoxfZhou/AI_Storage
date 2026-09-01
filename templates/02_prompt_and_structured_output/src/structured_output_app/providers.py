"""结构化输出 Provider 接口与 OpenAI 实现。"""

from __future__ import annotations

import os
from typing import Protocol

from openai import OpenAI

from .schemas import SupportTicket


class StructuredExtractor(Protocol):
    def extract(self, *, model: str, prompt: str, max_output_tokens: int) -> SupportTicket: ...


class OpenAIStructuredExtractor:
    def __init__(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for a real API call")
        self.client = OpenAI(api_key=api_key)

    def extract(self, *, model: str, prompt: str, max_output_tokens: int) -> SupportTicket:
        # WHY: responses.parse 让 SDK 按 Pydantic Schema 请求并解析结构化输出。
        response = self.client.responses.parse(
            model=model,
            input=prompt,
            max_output_tokens=max_output_tokens,
            text_format=SupportTicket,
        )
        if response.output_parsed is None:
            # FAILURE MODE: 拒答或不完整响应不能伪装成空工单进入数据库。
            raise ValueError("模型没有返回可解析的 SupportTicket")
        return response.output_parsed
