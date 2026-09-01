"""会话模板配置读取与类型校验。"""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field


class ModelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    max_output_tokens: int = Field(ge=1, le=32768)


class MemorySettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    store_directory: Path
    max_local_turns: int = Field(ge=1, le=200)
    store_provider_response: bool


class PromptSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system_file: Path


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: ModelSettings
    memory: MemorySettings
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
