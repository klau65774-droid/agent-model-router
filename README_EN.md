# agent-model-router (English)

[中文说明](README.md)

A zero-dependency prompt routing engine that embeds into coding agents (Kimi Code, Claude Code, Codex, Cursor and any MCP client). Give it a prompt — it returns a **task profile + recommended model + recommended thinking effort + ready-to-use API params**.

- Zero dependencies: runs on Node ≥ 18, no `npm install`, no network required
- Three embedding forms: **CLI** / **MCP server** / **Claude Code Hook**
- Built-in model libraries: `kimi` (K3 / K2.8 Preview / K2.7 Code / K2.6) and `claude` (Opus 4.6 / Sonnet 4.6 / Haiku 4.5)
- Strategy inspired by TypeSafe Jev routing practice: typed questions + calibrated confidence + confidence-gated escalation + fail-open + shadow mode

## Quick Start

### One-click install (recommended)

```bash
git clone https://github.com/klau65774-droid/agent-model-router.git
cd agent-model-router

# Linux / macOS / Windows Git Bash
bash install.sh

# Windows PowerShell
powershell -ExecutionPolicy Bypass -File install.ps1
```

The installer will: check Node ≥ 18 → register the MCP server into **Kimi Code** (`~/.kimi-code/mcp.json`, backing up the original config) → register into **Claude Code** (when the `claude` CLI is detected) → install the Claude Code skill (`~/.claude/skills/model-router`).

### Manual CLI usage

```bash
# Decide (human-readable output)
node router.mjs decide "Refactor this Python crawler with resume support"

# JSON output (for programmatic use)
node router.mjs decide "Parse this JSON into a table" --json

# Choose model library / routing preference
node router.mjs decide "review this PR" --profile claude --preset quality

# Pipe input
echo "Prove that sqrt(2) is irrational" | node router.mjs decide

# Inspect model library and routing policy
node router.mjs models --profile kimi
node router.mjs policy

# Shadow mode: only log to ~/.agent-model-router/log.jsonl, no suggestions (for calibration)
node router.mjs decide "..." --shadow
```

## Embedding into Claude Code (three ways, can be combined)

### ① UserPromptSubmit hook (auto-inject routing advice on every prompt)

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/agent-model-router/router.mjs hook --profile kimi"
          }
        ]
      }
    ]
  }
}
```

Effect: on every message you send, Claude Code receives an injected line such as
`[model-router] task=code(89%) complexity=64 → recommended Kimi K2.7 Code, thinking effort HIGH…`
and Claude can advise switching model/tier accordingly. If the hook fails it outputs `{}` and **never blocks the conversation** (fail-open).

### ② MCP server (the agent actively calls the `route_prompt` tool)

In the project root `.mcp.json` (or via `claude mcp add`):

```json
{
  "mcpServers": {
    "agent-model-router": {
      "command": "node",
      "args": ["/absolute/path/to/agent-model-router/mcp-server.mjs"]
    }
  }
}
```

### ③ Skill (teaches Claude when to route)

```bash
# Windows
xcopy /E /I ".\skills\model-router" "%USERPROFILE%\.claude\skills\model-router"
# macOS / Linux
cp -r ./skills/model-router ~/.claude/skills/
```

## Embedding into Kimi Code

Edit the user-level MCP config `~/.kimi-code/mcp.json` (Windows: `C:\Users\<you>\.kimi-code\mcp.json`; for project-level use `.kimi-code/mcp.json`, which takes precedence over same-named entries):

```json
{
  "mcpServers": {
    "agent-model-router": {
      "transport": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/agent-model-router/mcp-server.mjs"]
    }
  }
}
```

Then in Kimi Code run `/reload` to reload and `/mcp` to check the connection status (green means OK). You can also add it interactively with `/mcp-config` in the TUI.

Also add one line to the project `AGENTS.md` to guide the agent to route before non-trivial tasks:

```markdown
Before starting complex tasks (multi-file changes / long documents / architecture design),
call the agent-model-router route_prompt tool to get the recommended model and thinking
effort; if the tool is unavailable, ignore and continue (fail-open).
The thinking tier stays fixed within a session.
```

## Embedding into Codex CLI / Cursor / other MCP clients

Any client that supports MCP stdio can register:

```
command: node
args: ["<absolute path>/mcp-server.mjs"]
```

Codex in `~/.codex/config.toml`:

```toml
[mcp_servers.agent-model-router]
command = "node"
args = ["/absolute/path/to/agent-model-router/mcp-server.mjs"]
```

For environments without MCP support, use the CLI directly plus `AGENTS.md` guidance (the agent invokes it via Bash).

## Output contract (route_prompt / decide --json)

```jsonc
{
  "profile": {           // task profile (all with confidence)
    "taskType":  { "value": "code", "confidence": 0.89 },
    "complexity": { "value": 64 },
    "effort":    { "value": "high" },   // recommended thinking effort low/high/max
    "hold": false, "holdReasons": []     // confidence gate
  },
  "recommendation": {
    "model": "kimi-k2.7-code",
    "effort": "high",
    "apiParams": {},                     // ready-to-use call params
    "thinkingNote": "This model always thinks; the tier is not adjustable"
  },
  "ranking": [ /* all candidates + scores + reasons + risks */ ]
}
```

## Custom model library

`router.config.json` (passed via `--config`) can switch the default library or replace models entirely:

```json
{
  "profile": "kimi",
  "preset": "balanced",
  "models": [ { "id": "my-model", "name": "...", "tier": "pro", "caps": { "reasoning": 9, "coding": 9, "chinese": 9, "writing": 9, "agentic": 9 }, "modalities": { "image": true, "video": false }, "contextK": 256, "priceIn": 1, "priceOut": 4, "speedTps": 80, "openWeights": false, "thinking": "effort" } ]
}
```

## Design principles (consistent with Jev routing practice)

1. **Escalate when uncertain**: confidence < 0.6 or top two task scores too close → HOLD, recommend one tier up, thinking effort low→high. Misrouting to a weaker model costs quality; misrouting to a stronger one only costs tokens.
2. **Fail-open**: any exception in the routing tool never blocks the agent's main flow.
3. **Shadow before enable**: `--shadow` logs only, without intervening; the logs are the basis for calibrating thresholds.
4. **Tier fixed within a session**: switching tiers breaks prefix caching.

## License

MIT
