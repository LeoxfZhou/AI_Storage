"""评测样本、候选返回、逐例结果和汇总。"""

from typing import Protocol

from pydantic import BaseModel, Field


class EvalCase(BaseModel):
    id: str
    input: str
    must_contain: list[str] = Field(default_factory=list)
    must_not_contain: list[str] = Field(default_factory=list)
    category: str = "general"


class CandidateReply(BaseModel):
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    response_id: str | None = None


class Candidate(Protocol):
    def generate(self, user_input: str) -> CandidateReply: ...


class CaseResult(BaseModel):
    case_id: str
    category: str
    passed: bool
    score: float
    missing_required: list[str]
    present_forbidden: list[str]
    output: str
    latency_ms: float
    input_tokens: int
    output_tokens: int
    estimated_cost: float
    response_id: str | None = None


class EvalSummary(BaseModel):
    total: int
    passed: int
    pass_rate: float
    average_score: float
    total_input_tokens: int
    total_output_tokens: int
    total_estimated_cost: float
    average_latency_ms: float
