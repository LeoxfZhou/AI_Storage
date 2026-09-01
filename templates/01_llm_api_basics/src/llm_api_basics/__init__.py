"""LLM API 基础模板的公共类型。"""

from .schemas import GenerationRequest, GenerationResult
from .service import BasicLLMService

__all__ = ["BasicLLMService", "GenerationRequest", "GenerationResult"]
