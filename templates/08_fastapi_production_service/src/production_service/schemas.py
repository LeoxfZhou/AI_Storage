"""公开 HTTP Schema 与内部 Provider 合同。"""

from typing import Protocol

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1)


class ChatResponse(BaseModel):
    answer: str
    response_id: str
    request_id: str


class ModelReply(BaseModel):
    text: str
    response_id: str


class AsyncTextProvider(Protocol):
    async def generate(self, user_input: str) -> ModelReply: ...
