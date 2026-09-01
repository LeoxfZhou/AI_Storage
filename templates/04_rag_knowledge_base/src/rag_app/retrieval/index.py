"""用于学习的小型内存向量索引。"""

import math

from ..schemas import Chunk, Embedder, SearchHit


def _cosine(left: list[float], right: list[float]) -> float:
    if len(left) != len(right):
        raise ValueError("向量维度不一致；可能混用了不同 Embedding 模型")
    denominator = math.sqrt(sum(x * x for x in left)) * math.sqrt(sum(x * x for x in right))
    return 0.0 if denominator == 0 else sum(x * y for x, y in zip(left, right)) / denominator


class InMemoryVectorIndex:
    def __init__(self, embedder: Embedder) -> None:
        self.embedder = embedder
        self._rows: list[tuple[Chunk, list[float]]] = []

    def build(self, chunks: list[Chunk]) -> None:
        self._rows = list(zip(chunks, self.embedder.embed([chunk.text for chunk in chunks]))) if chunks else []

    def search(self, query: str, *, top_k: int, min_score: float) -> list[SearchHit]:
        if not self._rows:
            return []
        query_vector = self.embedder.embed([query])[0]
        hits = [
            SearchHit(chunk=chunk, vector_score=_cosine(query_vector, vector), final_score=_cosine(query_vector, vector))
            for chunk, vector in self._rows
        ]
        return [hit for hit in sorted(hits, key=lambda item: item.final_score, reverse=True) if hit.final_score >= min_score][:top_k]
