"""命令行入口：解析人类输入，把执行交给 Service。"""

from __future__ import annotations

import argparse
from pathlib import Path

from .config import load_config
from .providers.openai_provider import OpenAIResponsesProvider
from .service import BasicLLMService


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="OpenAI Responses API 基础模板")
    parser.add_argument("input", help="发送给模型的文本")
    parser.add_argument("--config", type=Path, default=Path("configs/default.yaml"))
    parser.add_argument("--preset", type=Path)
    parser.add_argument("--stream", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    config = load_config(args.config, args.preset)
    instructions = config.prompt.system_file.read_text(encoding="utf-8").strip()
    provider = OpenAIResponsesProvider(
        timeout_seconds=config.model.timeout_seconds,
        max_retries=config.model.max_retries,
    )
    service = BasicLLMService(config, provider, instructions)

    if args.stream:
        for delta in service.stream(args.input):
            print(delta, end="", flush=True)
        print()
    else:
        print(service.generate(args.input).text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
