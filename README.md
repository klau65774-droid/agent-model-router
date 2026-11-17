# agent-model-router

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](package.json)
[![MCP Server](https://img.shields.io/badge/MCP-stdio-blueviolet)](mcp-server.mjs)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](install.sh)

**[English README](README_EN.md)** · An offline, zero-dependency routing engine with CLI, MCP stdio and Claude Code Hook entry points.

---

把「Kimi 决策台」的路由引擎做成可嵌入编码 Agent 的零依赖工具包。
输入一条提示词 → 输出**任务画像 + 推荐模型 + 推荐思考强度 + 可直接用的 API 参数**。

- 零依赖：Node ≥ 18 即可运行，无需 `npm install`、无需联网
- 三种嵌入形态：**CLI** / **MCP server** / **Claude Code Hook**
- 内置两套模型库：`kimi`（K3 / K2.8 Preview / K2.7 Code / K2.6）与 `claude`（Opus 4.6 / Sonnet 4.6 / Haiku 4.5）
- 独立输出任务类型、复杂度、需求不明确程度与失败影响。按输入模态、上下文、工具和估算预算筛选候选
- 支持本地反馈、固定基线和离线回放。[基线对比报告](docs/evaluation.md) · [集成验证](docs/integration-test.md)

## 快速开始

### 一键安装（推荐）

```bash
git clone https://github.com/klau65774-droid/agent-model-router.git
cd agent-model-router

# Linux / macOS / Windows Git Bash
bash install.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File install.ps1
```

安装脚本会：检查 Node ≥ 18 → 注册 MCP 到 **Kimi Code**（`~/.kimi-code/mcp.json`，自动备份原配置）→ 注册到 **Claude Code**（检测到 `claude` CLI 时）→ 安装 Claude Code 技能（`~/.claude/skills/model-router`）。

### 手动使用 CLI

```bash
# 决策（文本输出）
node router.mjs decide "帮我重构这个 Python 爬虫，加断点续传"

# JSON 输出（供程序消费）
node router.mjs decide "把这个 JSON 解析成表格" --json

# 指定模型库 / 决策偏好
node router.mjs decide "review this PR" --profile claude --preset quality

# 管道输入
echo "证明根号 2 是无理数" | node router.mjs decide

# 查看模型库与路由策略
node router.mjs models --profile kimi
node router.mjs policy

# 影子模式：写入本地反馈日志，stdout 只显示记录编号
node router.mjs decide "提取记录编号" --shadow
```

## 嵌入 Claude Code（三种方式，可叠加）

### ① UserPromptSubmit 钩子（每条提示词自动注入路由建议）

在 `~/.claude/settings.json` 加入：

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node <path-to-repo>/agent-model-router/router.mjs hook --profile kimi"
          }
        ]
      }
    ]
  }
}
```

Claude Code 会收到类似 `[model-router] 任务=code（未校准） 复杂度=42/100 → 推荐模型 …，思考建议 HIGH` 的上下文。无可用候选、无结构化上下文的短提示或异常输入返回 `{}`，对话可继续。默认关闭记录。给命令添加 `--record` 可取得 `routeId`。

### ② MCP server（Agent 主动调用 `route_prompt` 工具）

在项目根目录 `.mcp.json`（或 `claude mcp add`）：

```json
{
  "mcpServers": {
    "agent-model-router": {
      "command": "node",
      "args": ["<path-to-repo>/agent-model-router/mcp-server.mjs"]
    }
  }
}
```

### ③ 技能（让 Claude 知道何时该路由）

```bash
# Windows
xcopy /E /I "<path-to-repo>\agent-model-router\skills\model-router" "%USERPROFILE%\.claude\skills\model-router"
# macOS / Linux
cp -r ./skills/model-router ~/.claude/skills/
```

## 嵌入 Kimi Code

编辑用户级 MCP 配置 `~/.kimi-code/mcp.json`（Windows：`C:\Users\<你>\.kimi-code\mcp.json`；项目级用 `.kimi-code/mcp.json`，同名条目以项目级为准）：

```json
{
  "mcpServers": {
    "agent-model-router": {
      "transport": "stdio",
      "command": "node",
      "args": ["<path-to-repo>/agent-model-router/mcp-server.mjs"]
    }
  }
}
```

然后在 Kimi Code 里 `/reload` 重载、`/mcp` 查看连接状态（绿色即成功）。也可以在 TUI 里用 `/mcp-config` 交互式添加。

同时在项目 `AGENTS.md` 中加入一行，引导 Agent 在非平凡任务前先路由：

```markdown
开始复杂任务（多文件改动 / 长文档 / 架构设计）前，先调用 agent-model-router 的
route_prompt 工具获取推荐模型与思考强度；若工具不可用，忽略并继续（fail-open）。
思考档位在同一会话中保持固定。
```

## 嵌入 Codex CLI / Cursor / 其他 MCP 客户端

任何支持 MCP stdio 的客户端，注册：

```
command: node
args: ["<绝对路径>/mcp-server.mjs"]
```

Codex 在 `~/.codex/config.toml`：

```toml
[mcp_servers.agent-model-router]
command = "node"
args = ["<path-to-repo>/agent-model-router/mcp-server.mjs"]
```

不支持 MCP 的环境，直接用 CLI + `AGENTS.md` 引导即可（Agent 通过 Bash 调用）。

## 结构化上下文

纯提示词调用仍可使用。宿主可通过 CLI 的 `--context task.json`、MCP 的 `context` 或 Hook stdin JSON 的 `context` 提供如下信息。CLI 的提示词参数或 stdin 可以携带原始材料。MCP 的 `prompt` 也支持这一用法。

```json
{
  "goal": "只从材料提取工单编号",
  "taskType": "extract",
  "inputTypes": ["document"],
  "requiredTools": [],
  "inputTokens": 45000,
  "expectedOutputTokens": 200,
  "failureImpact": "low",
  "budget": { "maxEstimatedUsd": 0.1 }
}
```

```bash
node router.mjs decide --context task.json --json
```

| 字段 | 作用 |
| --- | --- |
| `goal`、`taskType` | 所有字段均可选。`goal` 单独提供任务指令。`taskType` 可直接声明类别，有效值为 `code`、`agentic`、`reasoning`、`writing`、`translate`、`analysis`、`extract`、`multimodal`、`chat`、`knowledge`。 |
| `inputTypes` | `text`、`code`、`document`、`table`、`json`、`image`、`audio`、`video`。显式列表覆盖模态推断。多种媒体输入时，候选需支持全部声明模态。 |
| `requiredTools` | 要求模型目录中的 `tools` 列表声明全部工具。目录自带的模型未声明宿主工具，使用硬工具约束时可通过 `--config` 指定目录。 |
| `inputTokens`、`expectedOutputTokens` | 窗口要求以两者之和计算。缺少输入时估算当前可见文本。缺少预计输出时用输入的 1.6 倍作为窗口预留。未附长文材料时可由宿主补报输入大小。 |
| `failureImpact` | `low`、`medium` 或 `high`。与任务复杂度独立。 |
| `budget.maxEstimatedUsd` | 对目录标价乘以预计输入和输出 token 得到的估算费用设上限。使用预算时须填写 `expectedOutputTokens`，包括需计费的预计推理 token。实付费用需以执行记录为准。 |

纯提示词下，规则识别否定、引文、Markdown 引用及围栏、材料标题和独立的 `---` 分隔线。将指令放在材料前，或直接传入独立的 `goal`。未知字段或无效参数会返回错误。预算缺少必要信息时，`policy.constraints.status` 为 `incomplete`，推荐为空。

## 输出契约（route_prompt / decide --json）

```jsonc
{
  "policyVersion": "rules-v2.0.0",
  "routeId": null,       // 启用记录且写入成功后为 UUID
  "profile": {
    "taskType": { "value": "code", "confidence": 0.88, "confidenceKind": "heuristic", "calibration": "uncalibrated" },
    "complexity": { "value": 42, "kind": "heuristic", "calibration": "uncalibrated" },
    "ambiguity": { "value": "low", "reasons": [], "missingFields": [] },
    "failureImpact": { "value": "low" },
    "stakes": "low",    // 兼容字段，镜像 failureImpact.value
    "effort": { "value": "high" },
    "hold": false,
    "holdReasons": []
  },
  "recommendation": {
    "model": "kimi-k2.6",
    "score": 70,
    "scoreKind": "heuristic",
    "calibration": "uncalibrated",
    "effort": "high",
    "apiParams": { "thinking": { "type": "enabled", "keep": "all" } },
    "successProbability": { "value": null, "status": "uncalibrated" }
  },
  "ranking": [ /* 可行候选，首项为最终推荐 */ ],
  "filteredOut": [ /* 排除的候选和原因 */ ],
  "policy": { /* hold、holdReasons、gate、constraints */ }
}
```

分类 `confidence` 是兼容保留的启发式分值。宿主直接声明类型时标记为 `host_provided`。候选综合分用于排序，任务成功概率在缺少匹配的执行标签时为 `null`。多个动作竞争或输入信息缺失时，`profile.ambiguity` 提供原因和需补齐的字段。

HOLD 将明确高失败影响的请求优先匹配旗舰档，将中等失败影响或明显不明确的请求优先匹配至少专业档。所有硬约束仍然生效。查看 `policy.gate.before`、`after`、`tierRaised`、`effortRaised` 和 `apiParamsChanged` 可区分模型档位、思考建议和实际调用参数的变化。门控优先级可能使首选的原始分值低于其他候选。

## 自定义模型库

`router.config.json` 可切换默认模型库或整体替换模型。CLI、Hook 和 MCP server 均支持 `--config router.config.json`。

```json
{
  "profile": "kimi",
  "preset": "balanced",
  "models": [ { "id": "my-model", "name": "...", "tier": "pro", "caps": { "reasoning": 9, "coding": 9, "chinese": 9, "writing": 9, "agentic": 9 }, "modalities": { "image": true, "video": false }, "tools": ["web"], "contextK": 256, "priceIn": 1, "priceOut": 4, "speedTps": 80, "openWeights": false, "thinking": "effort" } ]
}
```

## 本地反馈和离线回放

CLI 使用 `--record` 获取 `routeId`，或使用 `--shadow` 只记录影子建议。MCP 用 `route_prompt` 的 `record: true` 生成编号，再调用 `record_feedback`。反馈为本地 JSONL，默认路径是 `~/.agent-model-router/feedback.jsonl`，只记录选定元数据。反馈可记录采纳偏好或带判据的执行结果。文件字段、指标来源、路径和示例见 [反馈格式](docs/feedback.md)。

```bash
node router.mjs decide "提取订单号" --json --record
node router.mjs feedback feedback-request.json
npm test
node eval/replay.mjs --split tuning
node eval/replay.mjs --check --out replay-result.md
node eval/replay.mjs --check --feedback ~/.agent-model-router/feedback.jsonl
```

[样例集](eval/cases.jsonl) 按语义组分配调参集和保留集。[冻结基线](eval/baseline.json) 可直接离线回放。完整 Git 历史可用 `npm run baseline -- --out rebuilt-baseline.json` 从固定提交复算。只有满足保留集验收的策略才应更新。合成标签用于回归，本地反馈供离线分析。实测结果另见 [评测报告](docs/evaluation.md)。
