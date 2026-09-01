"""业务层与 Agent Runner 的稳定合同。"""

from typing import Protocol

from pydantic import BaseModel


class AgentResult(BaseModel):
    final_output: str
    last_agent: str


class AgentRunner(Protocol):
    def run(self, user_input: str) -> AgentResult: ...
