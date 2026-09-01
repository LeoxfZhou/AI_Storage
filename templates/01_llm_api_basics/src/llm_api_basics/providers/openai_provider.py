"""将内部 GenerationRequest 翻译为 OpenAI Responses API 调用。"""

from __future__ import annotations

import os
from collections.abc import Iterator

from openai import OpenAI

from ..schemas import GenerationRequest, GenerationResult


class OpenAIResponsesProvider:
    def __init__(self, *, timeout_seconds: float, max_retries: int) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for a real API call")
        self.client = OpenAI(
            api_key=api_key,
            timeout=timeout_seconds,
            max_retries=max_retries,
        )

    @staticmethod
    def _kwargs(request: GenerationRequest) -> dict[str, object]:
        kwargs: dict[str, object] = {
            "model": request.model,
            "instructions": request.instructions,
            "input": request.user_input,
            "max_output_tokens": request.max_output_tokens,
        }
        # WHY: 可选参数只有明确配置后才发送，减少跨模型兼容性问题。
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        return kwargs

    def generate(self, request: GenerationRequest) -> GenerationResult:
        response = self.client.responses.create(**self._kwargs(request))
        usage = getattr(response, "usage", None)
        return GenerationResult(
            text=response.output_text,
            response_id=response.id,
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
        )

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        stream = self.client.responses.create(**self._kwargs(request), stream=True)
        for event in stream:
            # FAILURE MODE: output 数组还可能含工具、推理等事件，不能假定每个事件都有 delta。
            if event.type == "response.output_text.delta":
                yield event.delta
