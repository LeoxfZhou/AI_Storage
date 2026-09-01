from fastapi.testclient import TestClient

from production_service.app import app
from production_service.dependencies import get_service
from production_service.schemas import ModelReply


class FakeService:
    async def chat(self, message: str) -> ModelReply:
        return ModelReply(text=f"echo:{message}", response_id="resp_test")


app.dependency_overrides[get_service] = lambda: FakeService()
client = TestClient(app)


def test_health_does_not_need_api_key() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_chat_returns_typed_response_and_request_id() -> None:
    response = client.post("/v1/chat", json={"message": "hello"}, headers={"X-Request-ID": "req-1"})
    assert response.status_code == 200
    assert response.json() == {"answer": "echo:hello", "response_id": "resp_test", "request_id": "req-1"}
    assert response.headers["X-Request-ID"] == "req-1"


def test_empty_message_fails_schema_validation() -> None:
    assert client.post("/v1/chat", json={"message": ""}).status_code == 422
