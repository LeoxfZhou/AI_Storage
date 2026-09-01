# 架构与数据流

- `ingestion/loader.py`：文件系统边界，只读取允许的后缀。
- `ingestion/chunker.py`：切块并用内容哈希去重。
- `retrieval/index.py`：保存向量并计算余弦相似度。
- `retrieval/reranker.py`：示范第二阶段词项重排。
- `generation/prompt.py`：把命中的 Chunk 转成有来源 ID 的上下文。
- `pipeline.py`：规定“无证据不生成”和引用合法性。
- `providers/openai_provider.py`：实现 Embedding 与 Responses API。

Embedding 和生成是两个独立 Protocol，因此可以分别替换或离线测试。
