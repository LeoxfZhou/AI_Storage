# 架构与数据流

```text
cases.jsonl -> EvalCase validation -> Candidate.generate
            -> deterministic graders -> CaseResult
            -> JsonlTraceWriter + aggregate Summary
```

Runner 使用 `perf_counter` 测墙钟时间；Provider 返回 API usage；成本计算与模型调用分离，便于以后接内部计费表。每个 Case 的失败原因保留，不能只输出一个平均分。
