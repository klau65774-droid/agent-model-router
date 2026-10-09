---
name: model-router
description: 在开始非平凡任务前，调用 agent-model-router 分析任务画像并推荐最优模型与思考强度（Kimi K3/K2.8/K2.7/K2.6、Claude Opus/Sonnet/Haiku）。当用户要求"选模型"、"用哪个模型"、"路由"、"评估这个 prompt 该用什么跑"时使用；也用于长任务启动前的自检。
---

# Model Router —— 提示词路由技能

本技能把 `agent-model-router` 的决策能力嵌入 Agent 工作流。
引擎为本地启发式规则（仿 TypeSafe Jev：typed questions → calibrated confidence → policy mapping），**零依赖、无需联网、毫秒级返回**。

## 何时调用

- 用户给出的任务明显复杂（多文件改动、架构设计、长文档分析）之前
- 用户明确要求"评估该用哪个模型 / 哪个思考档"
- 批量任务开始前，决定整条流水线用哪档模型
- 简单问答、闲聊、一行命令类任务**不要调用**（路由开销大于收益）

## 如何调用（按可用工具优先级）

1. **MCP**（若已注册 `agent-model-router` server）：
   调用 `route_prompt`，参数 `prompt` = 用户原始提示词，`preset` 默认 `balanced`。
2. **CLI**（兜底，任何环境可用）：
   ```bash
   node <router 目录>/router.mjs decide "<用户提示词>" --json
   ```

## 如何应用结果

读取 JSON 中的 `recommendation`：

- `model` / `modelName`：推荐模型
- `effort`：推荐思考强度（`low` / `high` / `max`）
- `apiParams`：直接可用的调用参数
  - effort 型 → `{"reasoning_effort": "high"}`（K3 / K2.8 Preview）
  - binary 型 → `{"thinking": {"type": "enabled","keep":"all"}}` 或 `disabled`（K2.6 / Claude）
  - always 型（K2.7 Code）→ 始终思考，无需传参

应用策略：

1. **推荐与当前一致** → 直接执行，不必向用户提及路由过程
2. **不一致** → 一句话告知用户推荐及理由，按客户端机制切换（如 `/model`），或询问用户是否切换
3. **`hold: true`（置信度门控触发）** → 推荐已自动上移一档；向用户说明门控原因（见 `policy.holdReasons`）
4. **fail-open** → 本工具任何异常、超时、输出缺失时，忽略它继续任务，绝不因路由失败阻断工作

## 硬性规则

- 思考档位**同一会话固定**：切换 `reasoning_effort` 会破坏前缀缓存，会话中途不得改档
- 路由结果只是建议：用户明确指定模型/档位时，**用户优先**
- 影子校准：批量使用前先以 `--shadow` 模式跑几天，用 `~/.agent-model-router/log.jsonl` 校准门限再启用自动切换
