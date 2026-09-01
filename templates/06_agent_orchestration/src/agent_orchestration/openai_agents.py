"""用 OpenAI Agents SDK 创建 Handoff 图。"""

from agents import Agent, ModelSettings, RunConfig, Runner

from .config import AppConfig
from .schemas import AgentResult


class OpenAIAgentsRunner:
    def __init__(self, config: AppConfig) -> None:
        model_settings = ModelSettings(max_tokens=config.agents.max_output_tokens)
        # CUSTOMIZE: 新增专业 Agent 时，同时更新 Triage Prompt、Handoff 描述和路由评测集。
        billing = Agent(
            name="Billing Specialist",
            handoff_description="处理收费、退款、发票和支付问题",
            instructions=config.prompts.billing.read_text(encoding="utf-8"),
            model=config.agents.model,
            model_settings=model_settings,
        )
        technical = Agent(
            name="Technical Specialist",
            handoff_description="处理故障、报错、性能和排障问题",
            instructions=config.prompts.technical.read_text(encoding="utf-8"),
            model=config.agents.model,
            model_settings=model_settings,
        )
        self.triage = Agent(
            name="Triage Agent",
            instructions=config.prompts.triage.read_text(encoding="utf-8"),
            model=config.agents.model,
            model_settings=model_settings,
            handoffs=[billing, technical],
        )
        self.max_turns = config.agents.max_turns
        self.run_config = RunConfig(workflow_name=config.tracing.workflow_name)

    def run(self, user_input: str) -> AgentResult:
        result = Runner.run_sync(
            self.triage,
            user_input,
            max_turns=self.max_turns,
            run_config=self.run_config,
        )
        return AgentResult(final_output=str(result.final_output), last_agent=result.last_agent.name)
