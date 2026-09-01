from pathlib import Path

from conversation_memory.config import load_config
from conversation_memory.schemas import ProviderReply
from conversation_memory.service import ConversationService
from conversation_memory.store import SessionStore


class FakeProvider:
    def __init__(self) -> None:
        self.previous_ids: list[str | None] = []

    def reply(self, **kwargs: object) -> ProviderReply:
        self.previous_ids.append(kwargs["previous_response_id"])
        return ProviderReply(text="fake reply", response_id=f"resp_{len(self.previous_ids)}")


def test_second_turn_uses_previous_response_id(tmp_path: Path) -> None:
    root = Path(__file__).parents[2]
    config = load_config(root / "configs/default.yaml")
    fake = FakeProvider()
    service = ConversationService(config, SessionStore(tmp_path), fake, "system")

    service.chat("demo", "first")
    service.chat("demo", "second")

    assert fake.previous_ids == [None, "resp_1"]
    assert len(SessionStore(tmp_path).load("demo").turns) == 2


def test_local_history_is_trimmed(tmp_path: Path) -> None:
    root = Path(__file__).parents[2]
    config = load_config(root / "configs/default.yaml")
    config.memory.max_local_turns = 1
    service = ConversationService(config, SessionStore(tmp_path), FakeProvider(), "system")
    service.chat("demo", "first")
    service.chat("demo", "second")
    assert [turn.user for turn in SessionStore(tmp_path).load("demo").turns] == ["second"]
