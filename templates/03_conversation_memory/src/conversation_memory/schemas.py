"""会话、单轮消息和 Provider 返回值的数据结构。"""

from datetime import datetime, timezone
from typing import Protocol

from pydantic import BaseModel, Field


class Turn(BaseModel):
    user: str
    assistant: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ConversationSession(BaseModel):
    session_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    previous_response_id: str | None = None
    turns: list[Turn] = Field(default_factory=list)


class ProviderReply(BaseModel):
    text: str
    response_id: str


class ConversationProvider(Protocol):
    def reply(
        self,
        *,
        model: str,
        instructions: str,
        user_input: str,
        previous_response_id: str | None,
        max_output_tokens: int,
        store: bool,
    ) -> ProviderReply: ...
