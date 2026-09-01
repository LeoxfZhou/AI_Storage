from pathlib import Path

import pytest

from structured_output_app.config import load_config
from structured_output_app.prompting import PromptRenderer
from structured_output_app.schemas import Priority, SupportTicket, TicketCategory
from structured_output_app.service import TicketExtractionService


class FakeExtractor:
    def extract(self, **_: object) -> SupportTicket:
        return SupportTicket(
            title="重复扣费",
            category=TicketCategory.BILLING,
            priority=Priority.NORMAL,
            summary="用户报告重复扣费",
            requested_action="退款",
            contains_sensitive_data=False,
        )


def _service() -> TicketExtractionService:
    root = Path(__file__).parents[2]
    config = load_config(root / "configs/default.yaml")
    return TicketExtractionService(config, PromptRenderer(root / config.prompt.template_file), FakeExtractor())


def test_extract_returns_typed_ticket() -> None:
    result = _service().extract("昨天扣费两次")
    assert result.category is TicketCategory.BILLING


def test_empty_input_fails_before_model_call() -> None:
    with pytest.raises(ValueError, match="不能为空"):
        _service().extract("   ")
