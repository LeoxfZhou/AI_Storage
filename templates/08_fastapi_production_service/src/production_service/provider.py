"""使用 AsyncOpenAI，避免在 FastAPI 事件循环中执行同步网络请求。"""

import os

from openai import AsyncOpenAI

from .config import AppConfig
from .schemas import ModelReply


class OpenAIAsyncProvider:
    def __init__(self, config: AppConfig, instructions: str) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for chat requests")
        self.config = config
        self.instructions = instructions
        self.client = AsyncOpenAI(
            api_key=api_key,
            timeout=config.server.request_timeout_seconds,
            max_retries=config.model.max_retries,
        )

    async def generate(self, user_input: str) -> ModelReply:
        response = await self.client.responses.create(
            model=self.config.model.name,
            instructions=self.instructions,
            input=user_input,
            max_output_tokens=self.config.model.max_output_tokens,
        )
        return ModelReply(text=response.output_text, response_id=response.id)
