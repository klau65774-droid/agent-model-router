# 集成实测验证 · Integration Test Report

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

用户级配置 `~/.kimi-code/mcp.json`（Windows：`C:\Users\35195\.kimi-code\mcp.json`）：

```json
{
  "mcpServers": {
    "agent-model-router": {
      "transport": "stdio",
      "command": "node",
      "args": ["D:/树莓派/树莓派/agent-model-router/mcp-server.mjs"]
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
