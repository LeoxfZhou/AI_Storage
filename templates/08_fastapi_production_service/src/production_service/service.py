"""HTTP 层与模型 Provider 之间的业务边界。"""

from .schemas import AsyncTextProvider, ModelReply


class ChatService:
    def __init__(self, provider: AsyncTextProvider, max_characters: int) -> None:
        self.provider = provider
        self.max_characters = max_characters

    async def chat(self, message: str) -> ModelReply:
        stripped = message.strip()
        if not stripped:
            raise ValueError("message 不能为空")
        if len(stripped) > self.max_characters:
            raise ValueError("message 超过最大长度")
        return await self.provider.generate(stripped)
