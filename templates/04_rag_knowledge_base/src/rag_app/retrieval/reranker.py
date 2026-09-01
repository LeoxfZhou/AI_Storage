"""可解释的词项重排示例。"""

import re

from ..schemas import SearchHit


def rerank(query: str, hits: list[SearchHit], *, lexical_weight: float) -> list[SearchHit]:
    query_terms = set(re.findall(r"[\w\u4e00-\u9fff]+", query.lower()))
    for hit in hits:
        text_terms = set(re.findall(r"[\w\u4e00-\u9fff]+", hit.chunk.text.lower()))
        lexical = len(query_terms & text_terms) / max(len(query_terms), 1)
        hit.final_score = (1 - lexical_weight) * hit.vector_score + lexical_weight * lexical
    return sorted(hits, key=lambda item: item.final_score, reverse=True)
