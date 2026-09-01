"""确定性工具循环：应用而不是模型拥有终止权。"""

from .schemas import ToolCallingModel
from .tools import ToolRegistry


class ToolLoopLimitError(RuntimeError):
    pass


class ToolWorkflow:
    def __init__(self, model: ToolCallingModel, registry: ToolRegistry, max_tool_rounds: int) -> None:
        self.model = model
        self.registry = registry
        self.max_tool_rounds = max_tool_rounds

    def run(self, user_input: str, *, approved_side_effects: bool = False) -> str:
        if not user_input.strip():
            raise ValueError("用户输入不能为空")
        turn = self.model.start(user_input)
        for _round in range(self.max_tool_rounds):
            if not turn.tool_calls:
                return turn.text
            outputs = [
                self.registry.execute(call, approved_side_effects=approved_side_effects)
                for call in turn.tool_calls
            ]
            turn = self.model.continue_with_outputs(turn.response_id, outputs)
        if turn.tool_calls:
            raise ToolLoopLimitError(f"工具调用超过上限：{self.max_tool_rounds}")
        return turn.text
