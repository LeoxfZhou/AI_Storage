"""批量评测 CLI。"""

import argparse
from pathlib import Path

from .config import load_config
from .providers import OpenAICandidate
from .runner import EvaluationRunner, load_cases
from .trace import JsonlTraceWriter


def main() -> int:
    parser = argparse.ArgumentParser(description="LLM 评测模板")
    parser.add_argument("--config", type=Path, default=Path("configs/default.yaml"))
    parser.add_argument("--preset", type=Path)
    args = parser.parse_args()
    config = load_config(args.config, args.preset)
    candidate = OpenAICandidate(
        model=config.model.name,
        instructions=config.prompt.system_file.read_text(encoding="utf-8").strip(),
        max_output_tokens=config.model.max_output_tokens,
    )
    summary = EvaluationRunner(
        candidate,
        JsonlTraceWriter(config.evaluation.output_file),
        pass_threshold=config.evaluation.pass_threshold,
        input_price=config.pricing.input_per_million_tokens,
        output_price=config.pricing.output_per_million_tokens,
    ).run(load_cases(config.evaluation.case_file))
    print(summary.model_dump_json(indent=2))
    return 0 if summary.passed == summary.total else 1


if __name__ == "__main__":
    raise SystemExit(main())
