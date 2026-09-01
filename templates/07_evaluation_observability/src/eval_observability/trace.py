"""逐例 JSONL Trace；真实项目需按敏感等级控制访问和保留期。"""

from pathlib import Path

from .schemas import CaseResult


class JsonlTraceWriter:
    def __init__(self, path: Path) -> None:
        self.path = path

    def reset(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("", encoding="utf-8")

    def write(self, result: CaseResult) -> None:
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(result.model_dump_json() + "\n")
