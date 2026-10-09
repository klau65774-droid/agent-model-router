#!/usr/bin/env bash
# agent-model-router 一键安装（Linux / macOS / Windows Git Bash）
# 注册 MCP 到 Kimi Code 与 Claude Code，并安装 Claude Code 技能
set -e
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> 检查 Node.js"
command -v node >/dev/null 2>&1 || { echo "✗ 需要 Node.js ≥ 18，请先安装"; exit 1; }
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[ "$NODE_MAJOR" -ge 18 ] || { echo "✗ Node 版本过低（需要 ≥ 18，当前 $(node -v)）"; exit 1; }
echo "✓ Node $(node -v)"

echo "==> 注册到 Kimi Code（~/.kimi-code/mcp.json）"
node "$DIR/scripts/register-mcp.mjs" "$HOME/.kimi-code/mcp.json" "$DIR"

echo "==> 注册到 Claude Code"
# 展示/注册用 Windows 原生路径（Git Bash 的 /d/... 路径其他程序不认）
WIN_DIR=$(node -p "process.argv[1].replace(/\\\\/g,'/')" "$DIR")
if command -v claude >/dev/null 2>&1; then
  claude mcp add agent-model-router -- node "$WIN_DIR/mcp-server.mjs" && echo "✓ Claude Code MCP 已注册"
else
  echo "- 未检测到 claude CLI，跳过（装好后可手动执行：claude mcp add agent-model-router -- node \"$WIN_DIR/mcp-server.mjs\"）"
fi

echo "==> 安装 Claude Code 技能"
if [ -d "$HOME/.claude" ]; then
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$HOME/.claude/skills/model-router"
  cp -r "$DIR/skills/model-router" "$HOME/.claude/skills/model-router"
  echo "✓ 技能已安装到 ~/.claude/skills/model-router"
else
  echo "- 未检测到 ~/.claude 目录，跳过技能安装"
fi

echo
echo "完成 ✅ 验证方式："
echo "  Kimi Code  ：/reload 然后 /mcp（看到 agent-model-router 绿色 connected）"
echo "  Claude Code：claude mcp list"
echo "  任意终端   ：node \"$DIR/router.mjs\" decide \"帮我写个快速排序\""
