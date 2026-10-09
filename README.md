# agent-model-router

把「Kimi 决策台」的路由引擎做成可嵌入编码 Agent 的零依赖工具包。
输入一条提示词 → 输出**任务画像 + 推荐模型 + 推荐思考强度 + 可直接用的 API 参数**。

- 零依赖：Node ≥ 18 即可运行，无需 `npm install`、无需联网
- 三种嵌入形态：**CLI** / **MCP server** / **Claude Code Hook**
- 内置两套模型库：`kimi`（K3 / K2.8 Preview / K2.7 Code / K2.6）与 `claude`（Opus 4.6 / Sonnet 4.6 / Haiku 4.5）
- 策略仿 TypeSafe Jev：类型化问题 + 校准置信度 + 门控上移 + 失败放行 + 影子模式

## 快速开始

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

# 影子模式：只记录到 ~/.agent-model-router/log.jsonl，不输出建议（校准用）
node router.mjs decide "..." --shadow
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
            "command": "node D:/树莓派/树莓派/agent-model-router/router.mjs hook --profile kimi"
          }
        ]
      }
    ]
  }
}
```

效果：你每发一条消息，Claude Code 会自动在上下文里收到一条
`[model-router] 任务=code(89%) 复杂度=64 → 推荐模型 Kimi K2.7 Code，思考强度 HIGH…`
的注入，Claude 据此建议切换模型/档位。钩子失败时输出 `{}`，**绝不阻断对话**（fail-open）。

### ② MCP server（Agent 主动调用 `route_prompt` 工具）

在项目根目录 `.mcp.json`（或 `claude mcp add`）：

```json
{
  "mcpServers": {
    "agent-model-router": {
      "command": "node",
      "args": ["D:/树莓派/树莓派/agent-model-router/mcp-server.mjs"]
    }
  }
}
```

### ③ 技能（让 Claude 知道何时该路由）

```bash
# Windows
xcopy /E /I "D:\树莓派\树莓派\agent-model-router\skills\model-router" "%USERPROFILE%\.claude\skills\model-router"
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
      "args": ["D:/树莓派/树莓派/agent-model-router/mcp-server.mjs"]
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
args = ["D:/树莓派/树莓派/agent-model-router/mcp-server.mjs"]
```

不支持 MCP 的环境，直接用 CLI + `AGENTS.md` 引导即可（Agent 通过 Bash 调用）。

## 输出契约（route_prompt / decide --json）

```jsonc
{
  "profile": {           // 任务画像（全部带置信度）
    "taskType":  { "value": "code", "confidence": 0.89 },
    "complexity": { "value": 64 },
    "effort":    { "value": "high" },   // 推荐思考强度 low/high/max
    "hold": false, "holdReasons": []     // 置信度门控
  },
  "recommendation": {
    "model": "kimi-k2.7-code",
    "effort": "high",
    "apiParams": {},                     // 直接可用的调用参数
    "thinkingNote": "该模型始终思考，档位不可调"
  },
  "ranking": [ /* 全部候选 + 得分 + 理由 + 风险 */ ]
}
```

## 自定义模型库

`router.config.json`（用 `--config` 指定）可切换默认模型库或整体替换模型：

```json
{
  "profile": "kimi",
  "preset": "balanced",
  "models": [ { "id": "my-model", "name": "...", "tier": "pro", "caps": { "reasoning": 9, "coding": 9, "chinese": 9, "writing": 9, "agentic": 9 }, "modalities": { "image": true, "video": false }, "contextK": 256, "priceIn": 1, "priceOut": 4, "speedTps": 80, "openWeights": false, "thinking": "effort" } ]
}
```

## 设计原则（与 Jev 路由实践一致）

1. **不确定就上移**：置信度 < 0.6 或前两类任务得分接近 → HOLD，推荐上移一档，思考强度 low→high。错配到弱模型损失质量，错配到强模型只多费 token。
2. **失败放行**：路由工具的任何异常都不阻断 Agent 主流程。
3. **先影子后启用**：`--shadow` 只记录不干预，日志是校准门限的依据。
4. **档位会话内固定**：切档破坏前缀缓存。
