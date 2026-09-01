"""确定性字符切块与内容去重。"""

import hashlib

from ..schemas import Chunk, Document


def chunk_documents(documents: list[Document], *, size: int, overlap: int) -> list[Chunk]:
    chunks: list[Chunk] = []
    seen_hashes: set[str] = set()
    step = size - overlap
    for document in documents:
        for start in range(0, len(document.text), step):
            text = document.text[start : start + size].strip()
            if not text:
                continue
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            # WHY: 相同内容只索引一次，避免重复证据挤占 top_k。
            if digest in seen_hashes:
                continue
            seen_hashes.add(digest)
            chunks.append(Chunk(id=digest[:12], source=document.source, text=text))
            if start + size >= len(document.text):
                break
    return chunks
