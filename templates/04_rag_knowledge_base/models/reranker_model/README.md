# reranker_model 模型卡

首版没有调用外部 Reranker 模型，而是使用可解释的词项重叠分数，与向量分数加权。生产项目可在 `retrieval/reranker.py` 后替换 Cross-Encoder 或托管 Reranker，并用 NDCG/Recall 评测收益。
