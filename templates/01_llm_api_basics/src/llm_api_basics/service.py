"""核心业务编排：构造模型请求，但不依赖任何厂商 SDK。"""

from __future__ import annotations

from collections.abc import Iterator

from .config import AppConfig
from .schemas import GenerationRequest, GenerationResult, TextGenerator


class BasicLLMService:
    def __init__(self, config: AppConfig, provider: TextGenerator, instructions: str) -> None:
        self.config = config
        self.provider = provider
        self.instructions = instructions

    def _request(self, user_input: str) -> GenerationRequest:
        """集中构造请求，保证同步和流式路径使用完全相同的参数。"""

        # CUSTOMIZE: 需要租户、语言或业务元数据时，在内部 Schema 中显式增加，
        # 不要把未校验的 CLI 字典直接透传给 Provider。
        return GenerationRequest(
            model=self.config.model.name,
            instructions=self.instructions,
            user_input=user_input,
            max_output_tokens=self.config.model.max_output_tokens,
            temperature=self.config.model.temperature,
        )

    def generate(self, user_input: str) -> GenerationResult:
        return self.provider.generate(self._request(user_input))

    def stream(self, user_input: str) -> Iterator[str]:
        yield from self.provider.stream(self._request(user_input))
