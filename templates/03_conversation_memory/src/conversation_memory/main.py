"""多轮会话 CLI 入口。"""

import argparse
from pathlib import Path

from .config import load_config
from .providers import OpenAIConversationProvider
from .service import ConversationService
from .store import SessionStore


def main() -> int:
    parser = argparse.ArgumentParser(description="多轮会话模板")
    parser.add_argument("message")
    parser.add_argument("--session", required=True)
    parser.add_argument("--config", type=Path, default=Path("configs/default.yaml"))
    parser.add_argument("--preset", type=Path)
    args = parser.parse_args()

    config = load_config(args.config, args.preset)
    service = ConversationService(
        config,
        SessionStore(config.memory.store_directory),
        OpenAIConversationProvider(),
        config.prompt.system_file.read_text(encoding="utf-8").strip(),
    )
    print(service.chat(args.session, args.message))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
