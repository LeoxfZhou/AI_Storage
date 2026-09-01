"""RAG 主流程，连接摄取、检索、生成并执行引用安全规则。"""

from .config import AppConfig
from .generation.prompt import AnswerPrompt
from .ingestion.chunker import chunk_documents
from .ingestion.loader import load_documents
from .retrieval.index import InMemoryVectorIndex
from .retrieval.reranker import rerank
from .schemas import AnswerGenerator, RagAnswer


class RagPipeline:
    def __init__(
        self,
        config: AppConfig,
        index: InMemoryVectorIndex,
        generator: AnswerGenerator,
        prompt: AnswerPrompt,
        instructions: str,
    ) -> None:
        self.config = config
        self.index = index
        self.generator = generator
        self.prompt = prompt
        self.instructions = instructions

    def build(self) -> int:
        documents = load_documents(self.config.retrieval.document_directory)
        chunks = chunk_documents(
            documents,
            size=self.config.retrieval.chunk_characters,
            overlap=self.config.retrieval.chunk_overlap,
        )
        self.index.build(chunks)
        return len(chunks)

    def answer(self, question: str) -> RagAnswer:
        if not question.strip():
            raise ValueError("问题不能为空")
        hits = self.index.search(
            question,
            top_k=self.config.retrieval.top_k,
            min_score=self.config.retrieval.min_score,
        )
        hits = rerank(question, hits, lexical_weight=self.config.retrieval.lexical_weight)
        if not hits:
            # FAILURE MODE: 没有证据时调用模型会诱发看似合理的无依据回答。
            return RagAnswer(answer="知识库中没有足够证据回答这个问题。", citations=[])

        result = self.generator.generate(
            prompt=self.prompt.render(question, hits),
            instructions=self.instructions,
        )
        allowed = {hit.chunk.id for hit in hits}
        result.citations = [citation for citation in result.citations if citation in allowed]
        return result
