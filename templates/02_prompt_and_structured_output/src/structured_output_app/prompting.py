"""Jinja2 Prompt 渲染器，位于原始输入和模型 Provider 之间。"""

from pathlib import Path

from jinja2 import Environment, StrictUndefined


class PromptRenderer:
    def __init__(self, template_path: Path) -> None:
        self.template = Environment(
            autoescape=False,
            undefined=StrictUndefined,
        ).from_string(template_path.read_text(encoding="utf-8"))

    def render(self, user_text: str) -> str:
        """渲染单个受控变量；StrictUndefined 防止变量拼错后静默变空。"""

        return self.template.render(user_text=user_text).strip()
