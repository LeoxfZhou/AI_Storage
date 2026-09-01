"""完全确定性的包含/禁止关键词 Grader。"""

from .schemas import EvalCase


def grade(case: EvalCase, output: str) -> tuple[float, list[str], list[str]]:
    # CUSTOMIZE: 为业务事实、引用和工具轨迹增加独立 Grader，不要把所有标准压成关键词。
    normalized = output.lower()
    missing = [value for value in case.must_contain if value.lower() not in normalized]
    forbidden = [value for value in case.must_not_contain if value.lower() in normalized]
    checks = len(case.must_contain) + len(case.must_not_contain)
    if checks == 0:
        return 1.0, [], []
    passed_checks = checks - len(missing) - len(forbidden)
    return max(0.0, passed_checks / checks), missing, forbidden
