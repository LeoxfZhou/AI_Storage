"""把 YAML 配置变成强类型对象，位于文件输入和业务 Service 之间。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field


class ModelConfig(BaseModel):
    """模型调用参数；禁止未知字段可以尽早发现拼写错误。"""

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1)
    max_output_tokens: int = Field(ge=1, le=32768)
    temperature: float | None = Field(default=None, ge=0, le=2)
    timeout_seconds: float = Field(ge=1, le=300)
    max_retries: int = Field(ge=0, le=5)


class PromptConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    system_file: Path


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: ModelConfig
    prompt: PromptConfig


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    """递归合并预设，避免一个小覆盖迫使用户复制整份默认配置。"""

    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = value
    return merged


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"配置文件不存在：{path}")
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"配置根节点必须是 mapping：{path}")
    return payload


def load_config(default_path: Path, preset_path: Path | None = None) -> AppConfig:
    """读取默认配置和可选预设。

    Args:
        default_path: 包含全部必需字段的 YAML。
        preset_path: 只包含差异字段的 YAML。

    Returns:
        经过 Pydantic 范围与未知字段校验的配置。
    """

    raw = _read_yaml(default_path)
    if preset_path is not None:
        raw = _deep_merge(raw, _read_yaml(preset_path))
    return AppConfig.model_validate(raw)
