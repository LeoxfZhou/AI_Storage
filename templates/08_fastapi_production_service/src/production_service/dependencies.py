"""延迟构造依赖，使 import、健康检查和单元测试不需要 API Key。"""

from functools import lru_cache

from .config import get_config
from .provider import OpenAIAsyncProvider
from .service import ChatService


@lru_cache(maxsize=1)
def get_service() -> ChatService:
    # WHY: 延迟构造让 import 和 /health 不依赖外部密钥或 Provider 可用性。
    config = get_config()
    instructions = config.prompt.system_file.read_text(encoding="utf-8").strip()
    return ChatService(OpenAIAsyncProvider(config, instructions), config.input.max_characters)
