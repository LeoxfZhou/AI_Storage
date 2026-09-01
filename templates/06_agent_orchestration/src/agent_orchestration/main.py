"""Agent 编排 CLI。"""

import argparse
from pathlib import Path

from .config import load_config
from .guardrails import LocalInputGuardrail
from .openai_agents import OpenAIAgentsRunner
from .service import OrchestrationService


def main() -> int:
    parser = argparse.ArgumentParser(description="Agent Handoff 模板")
    parser.add_argument("request")
    parser.add_argument("--config", type=Path, default=Path("configs/default.yaml"))
    parser.add_argument("--preset", type=Path)
    args = parser.parse_args()
    config = load_config(args.config, args.preset)
    result = OrchestrationService(
        LocalInputGuardrail(config.guardrail.max_input_characters),
        OpenAIAgentsRunner(config),
    ).handle(args.request)
    print(f"last_agent={result.last_agent}")
    print(result.final_output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
