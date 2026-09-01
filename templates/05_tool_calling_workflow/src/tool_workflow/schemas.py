"""模型轮次、工具调用和工具输出合同。"""

from typing import Protocol

from pydantic import BaseModel, Field


class ToolCall(BaseModel):
    call_id: str
    name: str
    arguments_json: str


class ToolOutput(BaseModel):
    call_id: str
    output_json: str


class ModelTurn(BaseModel):
    response_id: str
    text: str = ""
    tool_calls: list[ToolCall] = Field(default_factory=list)


class ToolCallingModel(Protocol):
    def start(self, user_input: str) -> ModelTurn: ...

    def continue_with_outputs(self, previous_response_id: str, outputs: list[ToolOutput]) -> ModelTurn: ...
