# 架构与数据流

`PromptRenderer` 只负责变量渲染；`TicketExtractionService` 管理输入边界；`StructuredExtractor` Protocol 隔离厂商 SDK；`SupportTicket` 是唯一可信输出合同。任何输出在离开 Service 前都必须成为合法的 Pydantic 对象。
