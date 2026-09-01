"""RAG 配置及参数边界。"""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator


class GenerationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str
    max_output_tokens: int = Field(ge=1, le=32768)


class EmbeddingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str


class RetrievalSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_directory: Path
    chunk_characters: int = Field(ge=100, le=10000)
    chunk_overlap: int = Field(ge=0, le=5000)
    top_k: int = Field(ge=1, le=50)
    min_score: float = Field(ge=-1, le=1)
    lexical_weight: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def overlap_must_be_smaller(self) -> "RetrievalSettings":
        if self.chunk_overlap >= self.chunk_characters:
            raise ValueError("chunk_overlap 必须小于 chunk_characters")
        return self


class PromptSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system_file: Path
    answer_template: Path


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    generation: GenerationSettings
    embedding: EmbeddingSettings
    retrieval: RetrievalSettings
    prompt: PromptSettings


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        merged[key] = _merge(merged[key], value) if isinstance(value, dict) and isinstance(merged.get(key), dict) else value
    return merged


def _read(path: Path) -> dict[str, Any]:
    value = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(value, dict):
        raise ValueError(f"配置根节点必须是 mapping：{path}")
    return value


def load_config(path: Path, preset: Path | None = None) -> AppConfig:
    raw = _read(path)
    if preset:
        raw = _merge(raw, _read(preset))
    return AppConfig.model_validate(raw)
