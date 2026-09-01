"""RAG 各阶段之间的数据合同。"""

from typing import Protocol

from pydantic import BaseModel, Field


class Document(BaseModel):
    source: str
    text: str


class Chunk(BaseModel):
    id: str
    source: str
    text: str


class SearchHit(BaseModel):
    chunk: Chunk
    vector_score: float
    final_score: float


class RagAnswer(BaseModel):
    answer: str
    citations: list[str] = Field(default_factory=list)


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class AnswerGenerator(Protocol):
    def generate(self, *, prompt: str, instructions: str) -> RagAnswer: ...
