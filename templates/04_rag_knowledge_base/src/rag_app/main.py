"""RAG CLI：启动时建立教学索引，再回答一个问题。"""

import argparse
from pathlib import Path

from .config import load_config
from .generation.prompt import AnswerPrompt
from .pipeline import RagPipeline
from .providers.openai_provider import OpenAIAnswerGenerator, OpenAIEmbedder
from .retrieval.index import InMemoryVectorIndex


def main() -> int:
    parser = argparse.ArgumentParser(description="RAG 知识库模板")
    parser.add_argument("question")
    parser.add_argument("--config", type=Path, default=Path("configs/default.yaml"))
    parser.add_argument("--preset", type=Path)
    args = parser.parse_args()
    config = load_config(args.config, args.preset)
    pipeline = RagPipeline(
        config,
        InMemoryVectorIndex(OpenAIEmbedder(config.embedding.model)),
        OpenAIAnswerGenerator(config.generation.model, config.generation.max_output_tokens),
        AnswerPrompt(config.prompt.answer_template),
        config.prompt.system_file.read_text(encoding="utf-8").strip(),
    )
    count = pipeline.build()
    print(f"indexed_chunks={count}")
    print(pipeline.answer(args.question).model_dump_json(indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
