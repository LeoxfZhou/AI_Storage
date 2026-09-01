"""Agent 图、Guardrail 和 Tracing 配置。"""

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict, Field


class AgentSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: str
    max_turns: int = Field(ge=1, le=20)
    max_output_tokens: int = Field(ge=1, le=32768)


class GuardrailSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_input_characters: int = Field(ge=1, le=100_000)


class TracingSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workflow_name: str


class PromptSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    triage: Path
    billing: Path
    technical: Path


class AppConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agents: AgentSettings
    guardrail: GuardrailSettings
    tracing: TracingSettings
    prompts: PromptSettings


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
