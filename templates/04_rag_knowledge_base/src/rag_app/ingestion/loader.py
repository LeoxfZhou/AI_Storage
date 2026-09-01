"""从允许的本地文本格式读取文档。"""

from pathlib import Path

from ..schemas import Document


# CUSTOMIZE: 接入 PDF/HTML 前先实现专门解析器、权限过滤和解析质量评测。
SUPPORTED_SUFFIXES = {".md", ".txt"}


def load_documents(directory: Path) -> list[Document]:
    if not directory.is_dir():
        raise NotADirectoryError(f"文档目录不存在：{directory}")
    documents: list[Document] = []
    for path in sorted(directory.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES:
            text = path.read_text(encoding="utf-8").strip()
            if text:
                documents.append(Document(source=str(path), text=text))
    return documents
