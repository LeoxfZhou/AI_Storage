"""将问题与检索结果渲染为带稳定引用 ID 的 Prompt。"""

from pathlib import Path

from jinja2 import Environment, StrictUndefined

from ..schemas import SearchHit


class AnswerPrompt:
    def __init__(self, path: Path) -> None:
        self.template = Environment(undefined=StrictUndefined, autoescape=False).from_string(
            path.read_text(encoding="utf-8")
        )

    def render(self, question: str, hits: list[SearchHit]) -> str:
        return self.template.render(question=question, hits=hits).strip()
