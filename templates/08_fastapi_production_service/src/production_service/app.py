"""FastAPI 入口、Request ID 中间件和稳定错误映射。"""

import logging
import uuid

from fastapi import Depends, FastAPI, HTTPException, Request

from .dependencies import get_service
from .schemas import ChatRequest, ChatResponse
from .service import ChatService


logger = logging.getLogger(__name__)
# CUSTOMIZE: 在公司环境接入统一鉴权、限流、指标和日志中间件。
app = FastAPI(title="LLM Production Template", version="0.1.0")


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    service: ChatService = Depends(get_service),
) -> ChatResponse:
    try:
        reply = await service.chat(payload.message)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:  # noqa: BLE001 - 外部错误必须映射成稳定 API 边界。
        # FAILURE MODE: 直接把 SDK 异常返回客户端可能泄露内部地址、参数或请求细节。
        logger.exception("model request failed", extra={"request_id": request.state.request_id})
        raise HTTPException(status_code=503, detail="model_service_unavailable") from error
    return ChatResponse(
        answer=reply.text,
        response_id=reply.response_id,
        request_id=request.state.request_id,
    )
