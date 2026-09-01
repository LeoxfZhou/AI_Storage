"""评测主循环和指标聚合。"""

import json
import time
from pathlib import Path

from .graders import grade
from .schemas import Candidate, CaseResult, EvalCase, EvalSummary
from .trace import JsonlTraceWriter


def load_cases(path: Path) -> list[EvalCase]:
    cases: list[EvalCase] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            cases.append(EvalCase.model_validate(json.loads(line)))
        except Exception as error:  # noqa: BLE001 - 添加行号后重新抛出便于定位数据。
            raise ValueError(f"无效评测样本 {path}:{line_number}: {error}") from error
    return cases


class EvaluationRunner:
    def __init__(
        self,
        candidate: Candidate,
        writer: JsonlTraceWriter,
        *,
        pass_threshold: float,
        input_price: float,
        output_price: float,
    ) -> None:
        self.candidate = candidate
        self.writer = writer
        self.pass_threshold = pass_threshold
        self.input_price = input_price
        self.output_price = output_price

    def run(self, cases: list[EvalCase]) -> EvalSummary:
        if not cases:
            raise ValueError("评测集不能为空")
        # WHY: 每次运行重置输出，避免把不同模型/Prompt 的样本混成一份报告。
        self.writer.reset()
        results: list[CaseResult] = []
        for case in cases:
            started = time.perf_counter()
            reply = self.candidate.generate(case.input)
            # FAILURE MODE: 这里测的是端到端墙钟时间，不能标注为模型纯推理时间。
            latency_ms = (time.perf_counter() - started) * 1000
            score, missing, forbidden = grade(case, reply.text)
            cost = (
                reply.input_tokens * self.input_price + reply.output_tokens * self.output_price
            ) / 1_000_000
            result = CaseResult(
                case_id=case.id,
                category=case.category,
                passed=score >= self.pass_threshold,
                score=score,
                missing_required=missing,
                present_forbidden=forbidden,
                output=reply.text,
                latency_ms=latency_ms,
                input_tokens=reply.input_tokens,
                output_tokens=reply.output_tokens,
                estimated_cost=cost,
                response_id=reply.response_id,
            )
            results.append(result)
            self.writer.write(result)
        count = len(results)
        return EvalSummary(
            total=count,
            passed=sum(result.passed for result in results),
            pass_rate=sum(result.passed for result in results) / count,
            average_score=sum(result.score for result in results) / count,
            total_input_tokens=sum(result.input_tokens for result in results),
            total_output_tokens=sum(result.output_tokens for result in results),
            total_estimated_cost=sum(result.estimated_cost for result in results),
            average_latency_ms=sum(result.latency_ms for result in results) / count,
        )
