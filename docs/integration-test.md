# 集成实测验证 · Integration Test Report

## 补充验收 · 2026-11-17

### 三平台回归与基线复现

`Router checks` 在公开仓库的标准 runner 上执行 `npm test`、`node eval/replay.mjs --check` 和 `node eval/capture-baseline.mjs --out baseline-rebuilt.json`，再比较重建快照与已提交快照。首轮 macOS 的旧基线目录通过符号链接访问，旧 CLI 用路径字符串识别入口，未执行 `models`。重建脚本现使用临时目录的实际路径，固定旧策略源码和快照保持原样。

| GitHub Actions runner | Node.js 18.20.8 | Node.js 24.14.0 |
| --- | --- | --- |
| Windows | 通过 | 通过 |
| Ubuntu | 通过 | 通过 |
| macOS | 通过 | 通过 |

以上结果来自 [修复后运行 44023015839](https://github.com/klau65774-droid/agent-model-router/actions/runs/44023015839)，代码提交为 `2a90c40`。在该次运行中，六组均通过保留集验收及快照复现。

### 本机宿主集成

| 宿主 | 在 Windows 上实际验证的路径 | 结果 |
| --- | --- | --- |
| Codex App Server 0.169.0-alpha.11.1 | `mcpServerStatus/list` 发现三个工具，临时线程通过 `mcpServer/tool/call` 调用 `route_prompt` | 收到 `rules-v2.0.0` 的 `extract` 推荐 |
| Claude Code 2.1.311 | 用 `--settings` 和 `--mcp-config` 提供临时配置，触发 `UserPromptSubmit` 和 MCP 工具调用 | 模拟模型服务收到 Hook 上下文与有效路由结果 |
| Kimi Code 0.15.0 | 通过临时 `KIMI_CODE_HOME` 加载 MCP 配置，使用 `kimi --prompt` 实际调用 `route_prompt` | 完成 MCP 握手、工具发现及往返，返回 `rules-v2.0.0` 的 `extract` 结果 |

Codex 通过实际宿主接口直接调用工具。Claude Code 和 Kimi Code 的模型端指向 `127.0.0.1`，由固定响应驱动工具调用。三项用于验证宿主集成。真实模型推理、桌面界面和其他平台上的宿主应用仍待实测。

### 如何验证成功率、成本和耗时

1. 选取同一批脱敏任务并在执行前确定成功判据，例如代码的自动测试、提取的预期字段或人工评审规则。
2. 旧、新策略分别接收同样的可用输入，按各自建议实际调用模型。保持固定的执行环境、预算和重试口径，记录模型的实际 ID 与参数。用各自的策略版本和 `routeId` 关联执行记录。旧版影子日志缺少执行结果，新的配对任务应在运行时写入版本化记录。
3. 将直接观测到的耗时和用量标为 `measured`。实测金额来自可核对的账单或服务记录，按目录计价的值标为 `estimated`。在回放报告里同时看每项指标的样本量。

```bash
node eval/replay.mjs --check --feedback path/to/feedback.jsonl --out execution-report.md
```

一轮公开样例可以验证采集链路。真实使用表现需要来自实际任务的执行结果，P95 在样本较少时应结合样本量理解。当前缺少真实执行记录。[反馈格式](feedback.md)

## v1.1.0 离线验收 · 2026-11-17

本次使用 Windows PowerShell 与 Node.js v24.14.0，在克隆工作区中验证。CLI、MCP 和 Hook 通过本地子进程驱动。旧版历史报告保留在下方。

| 实际命令 | 结果 |
| --- | --- |
| `node router.mjs decide "帮我重构这个 Python 爬虫，加断点续传" --json`（修改前） | 旧版分类 `code`，分类分值 0.89，复杂度 12，推荐 `kimi-k2.6 / high`。 |
| `git show 947db29b2b2c2197dc689661f44bb78ad086c1a8:router.mjs` 后运行 `node eval/capture-baseline.mjs --router <临时的旧 router.mjs> --out eval/baseline.json` | 两次生成 98 条基线结果，文件 SHA-256 均为 `c1f2efa77ce8fc8ca503bd04c73faffbfc548e49eb357f68deddd791a61614a3`。 |
| `node eval/replay.mjs --split tuning` | 旧 35/63，新 63/63。标注硬约束违规旧 7 条，新 0 条。 |
| `node eval/replay.mjs --check --out docs/evaluation.md` | 固定输入重复回放一致。保留集 35 条，硬约束违规旧 4 条、新 0 条，关键任务无新增回归。完整数据见 [离线评测](evaluation.md)。 |
| `npm.cmd test` | 20 项通过。包括原入口、上下文校验、预算及多模态筛选、HOLD、JSONL、回放实测汇总、失败处理。 |
| `git diff --check` | 通过空白检查。 |

### 初次验收的验证边界

- 98 条样例为合成数据，标注主要交付物、档位和硬约束。未取得独立人工标注或真实使用分布，无法估计真实任务的分类准确率。
- 本次回放缺少真实执行反馈，成功概率、平均费用、P50/P95 耗时与费用节省均不可评估。自动化测试使用的反馈记录是临时测试数据。
- MCP 通过 stdio 消息验证，Hook 通过 stdin/stdout 事件 JSON 验证。未启动 Kimi Code、Claude Code、Codex 等宿主进行端到端复测。macOS、Linux 和较早的 Node 版本未在本次环境实跑。
- 自由文本中未标明边界的材料、间接或多层否定、复合目标仍依赖规则。明确输入类型、分离目标或提交宿主提供的 `taskType` 可减少歧义。目录价格和输入能力取自本地目录快照，估算预算按可见或宿主提供的 token 计算。

## v1.0.0 历史验证

> 本文件记录 agent-model-router 在真实环境中的端到端验证结果，非纸面推断。
> 测试日期：2026-10-09 ｜ 环境：Windows 11 + Git Bash ｜ Node v24.21.0 ｜ 版本 v1.0.0

## 测试对象

| 形态 | 入口 | 嵌入目标 |
|---|---|---|
| CLI | `router.mjs decide` | 任意 Agent（经 Bash 调用） |
| MCP server | `mcp-server.mjs`（stdio，协议 2024-11-05） | Kimi Code / Claude Code / Codex / Cursor |
| Hook | `router.mjs hook`（UserPromptSubmit） | Claude Code |

## ① CLI 复测（通过）

```bash
$ node router.mjs decide "帮我重构这个 Python 爬虫，加断点续传"
任务画像：code（置信度 89%）
复杂度：12/100 ｜ 输入 ≈14 tok ｜ 利害：low ｜ 模态：none
推荐思考强度：HIGH（复杂度 12/100，日常开发/分析区间）

★ 首选：Kimi K2.6（综合分 71.1）
  调用参数：{"thinking":{"type":"enabled","keep":"all"}}

候选排行：K2.6 71.1 > K2.8 Preview 70.6 > K2.7 Code Highspeed 69.4 > K2.7 Code 68.9 > K3 60.3
```

结论：画像、置信度、思考强度、候选排行与风险提示（如 Highspeed「速度溢价 2×」）均正常输出。

## ② MCP server 复测（通过）

以 JSON-RPC 手工驱动 stdio：

```jsonc
→ {"id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05",...}}
← {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{}},
   "serverInfo":{"name":"agent-model-router","version":"1.0.0"}}}

→ {"id":2,"method":"tools/call","params":{"name":"route_prompt",
   "arguments":{"prompt":"review this PR for security issues","profile":"claude"}}}
← {"result":{"content":[{"type":"text","text":"{
     \"profile\":{\"taskType\":{\"value\":\"code\",\"confidence\":0.89,
       \"evidence\":[\"命中：review、security\"]}, ...},
     \"recommendation\":{\"model\":\"claude-haiku-4.5\",\"score\":74.3,...}}"}]}}
```

结论：握手返回 `serverInfo 1.0.0`；`route_prompt` 按 `--profile claude` 正确切到 Claude 库，
返回完整输出契约（profile + recommendation + apiParams + ranking）。

## ③ Kimi Code 集成（通过）

用户级配置 `~/.kimi-code/mcp.json`（Windows：`C:\Users\<username>\.kimi-code\mcp.json`）：

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

配合项目级 `AGENTS.md` 引导语：

> 开始复杂任务（多文件改动 / 长文档 / 架构设计）前，先调用 agent-model-router 的
> route_prompt 工具获取推荐模型与思考强度；若工具不可用，忽略并继续（fail-open）。
> 思考档位在同一会话中保持固定。

验证方式：`/reload` 重载后 `/mcp` 查看连接状态为绿色；会话中 Agent 可在复杂任务前主动路由。

## ④ Hook 复测（通过）

```bash
$ printf '{"prompt":"帮我把这个 Python 爬虫重构成支持断点续传的版本"}' \
  | node router.mjs hook --profile kimi
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":
"[model-router] 任务=code(89%) 复杂度=12/100 → 推荐模型 Kimi K2.6，思考强度 HIGH
（调用参数 {\"thinking\":{\"type\":\"enabled\",\"keep\":\"all\"}}）。
若当前模型/档位与推荐不符，请告知用户或按既定机制切换；此建议仅供参考，不阻断任务。"}}
```

同时验证了两条 fail-open 边界：

| 场景 | 输入 | 输出 | 判定 |
|---|---|---|---|
| 提示词过短（< 8 字符） | `{"prompt":"写一个二分查找"}` | `{}` | ✅ 放行，不注入噪音 |
| 非法 JSON / 异常 | 任意损坏输入 | `{}` | ✅ 绝不阻断对话 |

路由记录正常写入 `~/.agent-model-router/log.jsonl`（影子日志，供校准门限用）。

## 已知边界

- 提示词短于 8 字符时 Hook 不注入建议（设计如此：短指令不值得路由开销）。
- 本沙箱环境中 `node` 进程依赖 stdin 关闭退出；自动化测试请加超时或关闭 stdin，
  属环境特性，非工具缺陷。

## 复现方法

```bash
git clone https://github.com/klau65774-droid/agent-model-router.git
cd agent-model-router
node router.mjs decide "任意提示词"            # CLI
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}\n' | node mcp-server.mjs   # MCP
printf '{"prompt":"一条足够长的测试提示词"}' | node router.mjs hook   # Hook
```
