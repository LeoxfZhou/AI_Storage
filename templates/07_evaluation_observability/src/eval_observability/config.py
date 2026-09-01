"""评测数据、输出和估算成本配置。"""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field


class ModelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    max_output_tokens: int = Field(ge=1, le=32768)


class EvaluationSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_file: Path
    output_file: Path
    pass_threshold: float = Field(ge=0, le=1)


class PricingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    input_per_million_tokens: float = Field(ge=0)
    output_per_million_tokens: float = Field(ge=0)


class PromptSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system_file: Path


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: ModelSettings
    evaluation: EvaluationSettings
    pricing: PricingSettings
    prompt: PromptSettings


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        merged[key] = _merge(merged[key], value) if isinstance(value, dict) and isinstance(merged.get(key), dict) else value
    return merged


def _read(path: Path) -> dict[str, Any]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ValueError("配置根节点必须是 mapping")
    return raw


def load_config(path: Path, preset: Path | None = None) -> AppConfig:
    raw = _read(path)
    if preset:
        raw = _merge(raw, _read(preset))
    return AppConfig.model_validate(raw)
