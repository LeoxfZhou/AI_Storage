"""业务输出合同；这里的字段应与数据库和下游系统共同评审。"""

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class TicketCategory(str, Enum):
    BILLING = "billing"
    TECHNICAL = "technical"
    ACCOUNT = "account"
    OTHER = "other"


class Priority(str, Enum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class SupportTicket(BaseModel):
    """CUSTOMIZE: 用真实业务字段替换示例，但保持严格类型。"""

    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=100)
    category: TicketCategory
    priority: Priority
    summary: str = Field(min_length=1, max_length=1000)
    requested_action: str | None = Field(default=None, max_length=500)
    contains_sensitive_data: bool
