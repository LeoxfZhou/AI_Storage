# 04 · RAG 知识库模板

## 项目目标

完成一个可解释的本地 RAG 最小闭环：读取 Markdown/TXT、切块、去重、Embedding、向量检索、可选词项重排、带引用生成。适合内部文档问答；不适合把未授权资料上传给外部 Provider，也不能保证文档本身正确。

## 执行流程

```text
documents -> load_documents -> chunk_documents -> deduplicate
          -> Embedder -> InMemoryVectorIndex
question  -> retrieve -> lexical rerank -> context + citation IDs
          -> Generator -> RagAnswer(answer, citations)
```

空检索不会调用生成模型，而是明确返回“证据不足”。这条业务规则在 Pipeline，不依赖 Prompt 自觉。

## 运行

```bash
uv sync
export OPENAI_API_KEY="your-key"
uv run python -m rag_app.main "退款期限是多少？"
uv run pytest
```

教学版本使用内存索引，每次启动重新 Embedding。生产环境应换成持久向量库或 OpenAI Vector Store，并增加增量索引、访问控制和删除流程。
