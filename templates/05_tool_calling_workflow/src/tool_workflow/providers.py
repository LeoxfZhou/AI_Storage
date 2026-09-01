"""OpenAI Responses API 工具调用适配器。"""

import os

from openai import OpenAI

from .schemas import ModelTurn, ToolCall, ToolOutput


class OpenAIToolModel:
    def __init__(
        self,
        *,
        model: str,
        instructions: str,
        tools: list[dict[str, object]],
        max_output_tokens: int,
        parallel_tool_calls: bool,
    ) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is required for a real API call")
        self.client = OpenAI(api_key=api_key)
        self.model = model
        self.instructions = instructions
        self.tools = tools
        self.max_output_tokens = max_output_tokens
        self.parallel_tool_calls = parallel_tool_calls

    def start(self, user_input: str) -> ModelTurn:
        response = self.client.responses.create(
            model=self.model,
            instructions=self.instructions,
            input=user_input,
            tools=self.tools,
            max_output_tokens=self.max_output_tokens,
            parallel_tool_calls=self.parallel_tool_calls,
        )
        return self._turn(response)

    def continue_with_outputs(self, previous_response_id: str, outputs: list[ToolOutput]) -> ModelTurn:
        response = self.client.responses.create(
            model=self.model,
            instructions=self.instructions,
            previous_response_id=previous_response_id,
            input=[
                {"type": "function_call_output", "call_id": output.call_id, "output": output.output_json}
                for output in outputs
            ],
            tools=self.tools,
            max_output_tokens=self.max_output_tokens,
            parallel_tool_calls=self.parallel_tool_calls,
        )
        return self._turn(response)

    @staticmethod
    def _turn(response: object) -> ModelTurn:
        calls = [
            ToolCall(call_id=item.call_id, name=item.name, arguments_json=item.arguments)
            for item in response.output
            if item.type == "function_call"
        ]
        return ModelTurn(response_id=response.id, text=response.output_text or "", tool_calls=calls)
