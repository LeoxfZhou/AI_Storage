"""将一段 CLI 文本转换为 JSON 工单。"""

import argparse
from pathlib import Path

from .config import load_config
from .prompting import PromptRenderer
from .providers import OpenAIStructuredExtractor
from .service import TicketExtractionService


def main() -> int:
    parser = argparse.ArgumentParser(description="结构化工单抽取")
    parser.add_argument("text")
    parser.add_argument("--config", type=Path, default=Path("configs/default.yaml"))
    parser.add_argument("--preset", type=Path)
    args = parser.parse_args()

    config = load_config(args.config, args.preset)
    service = TicketExtractionService(
        config,
        PromptRenderer(config.prompt.template_file),
        OpenAIStructuredExtractor(),
    )
    print(service.extract(args.text).model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
