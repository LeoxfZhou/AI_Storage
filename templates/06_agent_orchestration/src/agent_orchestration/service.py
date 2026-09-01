"""在 Guardrail 和 Agent Runner 之间建立业务安全边界。"""

from .guardrails import LocalInputGuardrail
from .schemas import AgentResult, AgentRunner


class OrchestrationService:
    def __init__(self, guardrail: LocalInputGuardrail, runner: AgentRunner) -> None:
        self.guardrail = guardrail
        self.runner = runner

    def handle(self, user_input: str) -> AgentResult:
        # WHY: 本地边界先运行，明显违规输入不会产生模型费用或进入 Trace。
        self.guardrail.validate(user_input)
        # FAILURE MODE: 不要在这里捕获并伪装所有 SDK 错误；上层需要区分失败与正常回答。
        return self.runner.run(user_input)
