import json

import pytest

from tool_workflow.schemas import ModelTurn, ToolCall, ToolOutput
from tool_workflow.tools import ToolRegistry
from tool_workflow.workflow import ToolLoopLimitError, ToolWorkflow


def test_side_effect_tool_requires_approval() -> None:
    output = ToolRegistry().execute(
        ToolCall(call_id="c1", name="create_ticket", arguments_json='{"title":"x","description":"y"}'),
        approved_side_effects=False,
    )
    assert json.loads(output.output_json)["error"]["code"] == "approval_required"


def test_invalid_arguments_are_returned_as_tool_error() -> None:
    output = ToolRegistry().execute(
        ToolCall(call_id="c1", name="get_weather", arguments_json="{}"),
        approved_side_effects=False,
    )
    assert json.loads(output.output_json)["error"]["code"] == "invalid_arguments"


class EndlessToolModel:
    def start(self, user_input: str) -> ModelTurn:
        return self._turn("r1")

    def continue_with_outputs(self, previous_response_id: str, outputs: list[ToolOutput]) -> ModelTurn:
        return self._turn(previous_response_id + "x")

    @staticmethod
    def _turn(response_id: str) -> ModelTurn:
        return ModelTurn(
            response_id=response_id,
            tool_calls=[ToolCall(call_id="c", name="get_weather", arguments_json='{"city":"上海"}')],
        )


def test_loop_limit_stops_repeated_tool_calls() -> None:
    with pytest.raises(ToolLoopLimitError):
        ToolWorkflow(EndlessToolModel(), ToolRegistry(), max_tool_rounds=2).run("weather")
