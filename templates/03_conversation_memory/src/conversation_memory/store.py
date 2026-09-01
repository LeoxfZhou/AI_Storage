"""JSON Session 存储；生产环境可用数据库实现同一接口替换。"""

from __future__ import annotations

import json
from pathlib import Path

from .schemas import ConversationSession


class SessionStore:
    """CUSTOMIZE: 生产环境实现同一 load/save 语义的事务型数据库 Store。"""

    def __init__(self, directory: Path) -> None:
        self.directory = directory

    def _path(self, session_id: str) -> Path:
        # ConversationSession 的正则防止 ../ 进入路径；这里再次构造类型以复用校验。
        validated = ConversationSession(session_id=session_id)
        return self.directory / f"{validated.session_id}.json"

    def load(self, session_id: str) -> ConversationSession:
        path = self._path(session_id)
        if not path.exists():
            return ConversationSession(session_id=session_id)
        return ConversationSession.model_validate_json(path.read_text(encoding="utf-8"))

    def save(self, session: ConversationSession) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        target = self._path(session.session_id)
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(
            json.dumps(session.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        # WHY: 同文件系统 replace 避免读者看到只写了一半的 JSON。
        temporary.replace(target)
