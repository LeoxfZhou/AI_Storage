"""定义 Service 与 Provider 之间稳定的数据契约。"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Protocol

from pydantic import BaseModel, Field


class GenerationRequest(BaseModel):
    model: str
    instructions: str
    user_input: str = Field(min_length=1, max_length=50_000)
    max_output_tokens: int
    temperature: float | None = None


class GenerationResult(BaseModel):
    text: str
    response_id: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class TextGenerator(Protocol):
    """任何模型 Provider 只要实现这两个方法就能接入 Service。"""

    def generate(self, request: GenerationRequest) -> GenerationResult: ...

    def stream(self, request: GenerationRequest) -> Iterator[str]: ...
