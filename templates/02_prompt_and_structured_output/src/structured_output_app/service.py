"""结构化抽取业务编排，不依赖 OpenAI SDK。"""

from .config import AppConfig
from .prompting import PromptRenderer
from .providers import StructuredExtractor
from .schemas import SupportTicket


class TicketExtractionService:
    def __init__(self, config: AppConfig, renderer: PromptRenderer, extractor: StructuredExtractor) -> None:
        self.config = config
        self.renderer = renderer
        self.extractor = extractor

    def extract(self, user_text: str) -> SupportTicket:
        """校验输入边界后执行抽取。

        Raises:
            ValueError: 输入为空或超过配置长度。
        """

        stripped = user_text.strip()
        if not stripped:
            raise ValueError("输入不能为空")
        if len(stripped) > self.config.input.max_characters:
            raise ValueError("输入超过 max_characters；请先分段或脱敏")
        return self.extractor.extract(
            model=self.config.model.name,
            prompt=self.renderer.render(stripped),
            max_output_tokens=self.config.model.max_output_tokens,
        )
