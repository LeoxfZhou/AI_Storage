from collections.abc import Iterator
from pathlib import Path

from llm_api_basics.config import load_config
from llm_api_basics.schemas import GenerationRequest, GenerationResult
from llm_api_basics.service import BasicLLMService


class FakeProvider:
    def __init__(self) -> None:
        self.last_request: GenerationRequest | None = None

    def generate(self, request: GenerationRequest) -> GenerationResult:
        self.last_request = request
        return GenerationResult(text="fake answer", response_id="resp_test")

    def stream(self, request: GenerationRequest) -> Iterator[str]:
        self.last_request = request
        yield "fake "
        yield "answer"


def test_service_passes_validated_config_to_provider() -> None:
    root = Path(__file__).parents[2]
    config = load_config(root / "configs/default.yaml")
    fake = FakeProvider()
    service = BasicLLMService(config, fake, "system instruction")

    result = service.generate("hello")

    assert result.text == "fake answer"
    assert fake.last_request is not None
    assert fake.last_request.model == config.model.name
    assert fake.last_request.instructions == "system instruction"


def test_streaming_keeps_delta_order() -> None:
    root = Path(__file__).parents[2]
    service = BasicLLMService(load_config(root / "configs/default.yaml"), FakeProvider(), "system")
    assert "".join(service.stream("hello")) == "fake answer"
