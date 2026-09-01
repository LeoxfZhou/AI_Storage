# Prompt 说明

每轮请求都会重新发送 `system.md`。使用 `previous_response_id` 时，上一次 instructions 不会自动继承；如果业务规则必须稳定，就不能只在第一轮发送。
