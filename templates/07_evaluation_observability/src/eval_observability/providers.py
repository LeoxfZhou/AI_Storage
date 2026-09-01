"""被评测的 OpenAI Responses API 候选实现。"""

import os

from openai import OpenAI

from .schemas import CandidateReply


class OpenAICandidate:
    def __init__(self, *, model: str, instructions: str, max_output_tokens: int) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for a real API call")
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.instructions = instructions
        self.max_output_tokens = max_output_tokens

    def generate(self, user_input: str) -> CandidateReply:
        response = self.client.responses.create(
            model=self.model,
            instructions=self.instructions,
            input=user_input,
            max_output_tokens=self.max_output_tokens,
        )
        usage = response.usage
        return CandidateReply(
            text=response.output_text,
            input_tokens=usage.input_tokens if usage else 0,
            output_tokens=usage.output_tokens if usage else 0,
            response_id=response.id,
        )
