"""工具调用 CLI。"""

import argparse
from pathlib import Path

from .config import load_config
from .providers import OpenAIToolModel
from .tools import TOOL_SCHEMAS, ToolRegistry
from .workflow import ToolWorkflow


def main() -> int:
    parser = argparse.ArgumentParser(description="工具调用工作流")
    parser.add_argument("request")
    parser.add_argument("--approve-side-effects", action="store_true")
    parser.add_argument("--config", type=Path, default=Path("configs/default.yaml"))
    parser.add_argument("--preset", type=Path)
    args = parser.parse_args()
    config = load_config(args.config, args.preset)
    model = OpenAIToolModel(
        model=config.model.name,
        instructions=config.prompt.system_file.read_text(encoding="utf-8").strip(),
        tools=TOOL_SCHEMAS,
        max_output_tokens=config.model.max_output_tokens,
        parallel_tool_calls=config.workflow.parallel_tool_calls,
    )
    print(ToolWorkflow(model, ToolRegistry(), config.workflow.max_tool_rounds).run(
        args.request,
        approved_side_effects=args.approve_side_effects,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
