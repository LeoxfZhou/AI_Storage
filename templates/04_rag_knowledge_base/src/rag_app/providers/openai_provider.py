"""OpenAI Embedding 与结构化生成实现。"""

import os

from openai import OpenAI

from ..schemas import RagAnswer


class OpenAIEmbedder:
    def __init__(self, model: str) -> None:
        self.model = model
        self.client = OpenAI(api_key=_api_key())

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        response = self.client.embeddings.create(model=self.model, input=texts)
        return [item.embedding for item in response.data]


class OpenAIAnswerGenerator:
    def __init__(self, model: str, max_output_tokens: int) -> None:
        self.model = model
        self.max_output_tokens = max_output_tokens
        self.client = OpenAI(api_key=_api_key())

    def generate(self, *, prompt: str, instructions: str) -> RagAnswer:
        response = self.client.responses.parse(
            model=self.model,
            instructions=instructions,
            input=prompt,
            max_output_tokens=self.max_output_tokens,
            text_format=RagAnswer,
        )
        if response.output_parsed is None:
            raise ValueError("模型没有返回可解析的 RagAnswer")
        return response.output_parsed


def _api_key() -> str:
    value = os.getenv("OPENAI_API_KEY")
    if not value:
        raise RuntimeError("OPENAI_API_KEY is required for a real API call")
    return value
