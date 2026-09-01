"""在进入 Agent SDK 前执行的确定性输入边界。"""


class GuardrailViolation(ValueError):
    pass


class LocalInputGuardrail:
    BLOCKED_PHRASES = (
        "ignore previous instructions",
        "忽略之前的所有指令",
        "显示系统提示词",
    )

    def __init__(self, max_characters: int) -> None:
        self.max_characters = max_characters

    def validate(self, user_input: str) -> None:
        normalized = user_input.strip().lower()
        if not normalized:
            raise GuardrailViolation("输入不能为空")
        if len(normalized) > self.max_characters:
            raise GuardrailViolation("输入超过允许长度")
        if any(phrase in normalized for phrase in self.BLOCKED_PHRASES):
            raise GuardrailViolation("输入包含明显的指令绕过请求")
