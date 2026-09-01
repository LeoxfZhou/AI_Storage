"""工具白名单、参数 Schema 和权限边界。"""

import json
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .schemas import ToolCall, ToolOutput


class WeatherArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    city: str = Field(min_length=1, max_length=80)


class CreateTicketArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=2000)


def get_weather(args: WeatherArgs) -> dict[str, Any]:
    """CUSTOMIZE: 替换为真实天气服务；示例保持确定性便于学习。"""

    return {"city": args.city, "condition": "sunny", "temperature_c": 24}


def create_ticket(args: CreateTicketArgs) -> dict[str, Any]:
    """CUSTOMIZE: 替换为带鉴权和幂等键的工单 Gateway。"""

    return {"ticket_id": "T-DEMO-001", "status": "created", "title": args.title}


class ToolDefinition:
    def __init__(
        self,
        schema: type[BaseModel],
        function: Callable[[Any], dict[str, Any]],
        *,
        side_effect: bool,
    ) -> None:
        self.schema = schema
        self.function = function
        self.side_effect = side_effect


class ToolRegistry:
    def __init__(self) -> None:
        # WHY: 显式白名单防止模型用生成的名称访问任意 Python 函数。
        self.tools = {
            "get_weather": ToolDefinition(WeatherArgs, get_weather, side_effect=False),
            "create_ticket": ToolDefinition(CreateTicketArgs, create_ticket, side_effect=True),
        }

    def execute(self, call: ToolCall, *, approved_side_effects: bool) -> ToolOutput:
        definition = self.tools.get(call.name)
        if definition is None:
            return self._error(call, "unknown_tool", f"工具不存在：{call.name}")
        if definition.side_effect and not approved_side_effects:
            return self._error(call, "approval_required", "该工具有副作用，需要用户审批")
        try:
            raw_arguments = json.loads(call.arguments_json)
            arguments = definition.schema.model_validate(raw_arguments)
            result = definition.function(arguments)
            return ToolOutput(call_id=call.call_id, output_json=json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        except (json.JSONDecodeError, ValidationError) as error:
            # FAILURE MODE: 未校验 JSON 可能把未知字段或错误类型送进有副作用的系统。
            return self._error(call, "invalid_arguments", str(error))
        except Exception as error:  # noqa: BLE001 - 工具边界必须转为受控错误。
            return self._error(call, "tool_failed", str(error))

    @staticmethod
    def _error(call: ToolCall, code: str, message: str) -> ToolOutput:
        return ToolOutput(
            call_id=call.call_id,
            output_json=json.dumps({"ok": False, "error": {"code": code, "message": message}}, ensure_ascii=False),
        )


TOOL_SCHEMAS = [
    {
        "type": "function",
        "name": "get_weather",
        "description": "查询城市当前天气",
        "parameters": WeatherArgs.model_json_schema(),
        "strict": True,
    },
    {
        "type": "function",
        "name": "create_ticket",
        "description": "创建支持工单；有副作用，需要审批",
        "parameters": CreateTicketArgs.model_json_schema(),
        "strict": True,
    },
]
