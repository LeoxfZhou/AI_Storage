"""生产服务配置；环境变量只指定配置路径，密钥不进入对象。"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field


class ServerSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    host: str
    port: int = Field(ge=1, le=65535)
    request_timeout_seconds: float = Field(ge=1, le=300)


class InputSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_characters: int = Field(ge=1, le=100_000)


class ModelSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str
    max_output_tokens: int = Field(ge=1, le=32768)
    max_retries: int = Field(ge=0, le=5)


class PromptSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system_file: Path


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    server: ServerSettings
    input: InputSettings
    model: ModelSettings
    prompt: PromptSettings


def _merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        merged[key] = _merge(merged[key], value) if isinstance(value, dict) and isinstance(merged.get(key), dict) else value
    return merged


def _read(path: Path) -> dict[str, Any]:
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raise ValueError(f"配置根节点必须是 mapping：{path}")
    return raw


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    path = Path(os.getenv("APP_CONFIG", "configs/default.yaml"))
    raw = _read(path)
    preset_value = os.getenv("APP_PRESET", "").strip()
    if preset_value:
        raw = _merge(raw, _read(Path(preset_value)))
    return AppConfig.model_validate(raw)
