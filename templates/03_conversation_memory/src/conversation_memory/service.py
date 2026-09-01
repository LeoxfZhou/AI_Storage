"""会话业务编排：读取、调用、更新和裁剪本地 Session。"""

from .config import AppConfig
from .schemas import ConversationProvider, Turn
from .store import SessionStore


class ConversationService:
    def __init__(
        self,
        config: AppConfig,
        store: SessionStore,
        provider: ConversationProvider,
        instructions: str,
    ) -> None:
        self.config = config
        self.store = store
        self.provider = provider
        self.instructions = instructions

    def chat(self, session_id: str, user_input: str) -> str:
        """执行一轮对话并在成功后保存状态。

        FAILURE MODE: Provider 失败时不保存用户消息，避免下一轮误以为模型已处理该轮。
        """

        if not user_input.strip():
            raise ValueError("用户输入不能为空")
        session = self.store.load(session_id)
        reply = self.provider.reply(
            model=self.config.model.name,
            instructions=self.instructions,
            user_input=user_input,
            previous_response_id=session.previous_response_id,
            max_output_tokens=self.config.model.max_output_tokens,
            store=self.config.memory.store_provider_response,
        )
        session.previous_response_id = reply.response_id
        session.turns.append(Turn(user=user_input, assistant=reply.text))
        session.turns = session.turns[-self.config.memory.max_local_turns :]
        self.store.save(session)
        return reply.text
