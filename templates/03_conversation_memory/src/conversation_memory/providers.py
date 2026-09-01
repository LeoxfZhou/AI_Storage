"""OpenAI 会话 Provider；通过 previous_response_id 续接服务端状态。"""

import os

from openai import OpenAI

from .schemas import ProviderReply


class OpenAIConversationProvider:
    def __init__(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for a real API call")
        self.client = OpenAI(api_key=api_key)

    def reply(
        self,
        *,
        model: str,
        instructions: str,
        user_input: str,
        previous_response_id: str | None,
        max_output_tokens: int,
        store: bool,
    ) -> ProviderReply:
        kwargs: dict[str, object] = {
            "model": model,
            "instructions": instructions,
            "input": user_input,
            "max_output_tokens": max_output_tokens,
            "store": store,
        }
        if previous_response_id:
            kwargs["previous_response_id"] = previous_response_id
        response = self.client.responses.create(**kwargs)
        return ProviderReply(text=response.output_text, response_id=response.id)
