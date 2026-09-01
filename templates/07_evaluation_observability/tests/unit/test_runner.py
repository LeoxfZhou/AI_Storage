from pathlib import Path

import pytest

from eval_observability.schemas import CandidateReply, EvalCase
from eval_observability.runner import EvaluationRunner
from eval_observability.trace import JsonlTraceWriter


class FakeCandidate:
    def generate(self, user_input: str) -> CandidateReply:
        return CandidateReply(text="请检查客户端超时和网络。", input_tokens=100, output_tokens=20)


def test_runner_aggregates_scores_tokens_and_cost(tmp_path: Path) -> None:
    cases = [EvalCase(id="1", input="x", must_contain=["超时"], must_not_contain=["已经修复"])]
    summary = EvaluationRunner(
        FakeCandidate(),
        JsonlTraceWriter(tmp_path / "results.jsonl"),
        pass_threshold=1.0,
        input_price=1.0,
        output_price=2.0,
    ).run(cases)
    assert summary.pass_rate == 1.0
    assert summary.total_input_tokens == 100
    assert summary.total_estimated_cost == pytest.approx(0.00014)
    assert (tmp_path / "results.jsonl").read_text(encoding="utf-8").count("\n") == 1


def test_empty_suite_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="不能为空"):
        EvaluationRunner(FakeCandidate(), JsonlTraceWriter(tmp_path / "x"), pass_threshold=1, input_price=0, output_price=0).run([])
