from pathlib import Path

from rag_app.config import load_config
from rag_app.generation.prompt import AnswerPrompt
from rag_app.ingestion.chunker import chunk_documents
from rag_app.pipeline import RagPipeline
from rag_app.retrieval.index import InMemoryVectorIndex
from rag_app.schemas import Document, RagAnswer


class KeywordEmbedder:
    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[float("退款" in text), float("地址" in text), 1.0] for text in texts]


class FakeGenerator:
    def __init__(self) -> None:
        self.calls = 0

    def generate(self, *, prompt: str, instructions: str) -> RagAnswer:
        self.calls += 1
        citation = prompt.split("[")[1].split("]")[0]
        return RagAnswer(answer="退款期限为七天。", citations=[citation, "invented"])


def test_duplicate_chunks_are_removed() -> None:
    documents = [Document(source="a", text="相同内容"), Document(source="b", text="相同内容")]
    assert len(chunk_documents(documents, size=100, overlap=0)) == 1


def test_empty_retrieval_does_not_call_generator(tmp_path: Path) -> None:
    root = Path(__file__).parents[2]
    config = load_config(root / "configs/default.yaml")
    config.retrieval.document_directory = tmp_path
    generator = FakeGenerator()
    pipeline = RagPipeline(
        config,
        InMemoryVectorIndex(KeywordEmbedder()),
        generator,
        AnswerPrompt(root / config.prompt.answer_template),
        "system",
    )
    pipeline.build()
    result = pipeline.answer("未知问题")
    assert generator.calls == 0
    assert result.citations == []


def test_unknown_citation_is_filtered(tmp_path: Path) -> None:
    (tmp_path / "policy.md").write_text("退款期限是七天。", encoding="utf-8")
    root = Path(__file__).parents[2]
    config = load_config(root / "configs/default.yaml")
    config.retrieval.document_directory = tmp_path
    generator = FakeGenerator()
    pipeline = RagPipeline(config, InMemoryVectorIndex(KeywordEmbedder()), generator, AnswerPrompt(root / config.prompt.answer_template), "system")
    pipeline.build()
    result = pipeline.answer("退款期限？")
    assert generator.calls == 1
    assert result.citations and "invented" not in result.citations
