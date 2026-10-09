# agent-model-router 一键安装（Windows PowerShell）
# 注册 MCP 到 Kimi Code 与 Claude Code，并安装 Claude Code 技能
$ErrorActionPreference = 'Stop'
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "==> 检查 Node.js"
try {
  $v = (node -v)
  $major = [int](node -p "process.versions.node.split('.')[0]")
  if ($major -lt 18) { throw "版本过低" }
  Write-Host "✓ Node $v"
} catch {
  Write-Host "✗ 需要 Node.js ≥ 18，请先安装" -ForegroundColor Red
  exit 1
}

Write-Host "==> 注册到 Kimi Code（`$env:USERPROFILE\.kimi-code\mcp.json）"
node "$Dir\scripts\register-mcp.mjs" "$env:USERPROFILE\.kimi-code\mcp.json" "$Dir"

Write-Host "==> 注册到 Claude Code"
if (Get-Command claude -ErrorAction SilentlyContinue) {
  claude mcp add agent-model-router -- node "$Dir\mcp-server.mjs"
  Write-Host "✓ Claude Code MCP 已注册"
} else {
  Write-Host "- 未检测到 claude CLI，跳过（装好后可手动执行：claude mcp add agent-model-router -- node `"$Dir\mcp-server.mjs`"）"
}

Write-Host "==> 安装 Claude Code 技能"
if (Test-Path "$env:USERPROFILE\.claude") {
  $skillDst = "$env:USERPROFILE\.claude\skills\model-router"
  if (Test-Path $skillDst) { Remove-Item -Recurse -Force $skillDst }
  New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills" | Out-Null
  Copy-Item -Recurse "$Dir\skills\model-router" $skillDst
  Write-Host "✓ 技能已安装到 $skillDst"
} else {
  Write-Host "- 未检测到 ~/.claude 目录，跳过技能安装"
}

Write-Host ""
Write-Host "完成 ✅ 验证方式："
Write-Host "  Kimi Code  ：/reload 然后 /mcp（看到 agent-model-router 绿色 connected）"
Write-Host "  Claude Code：claude mcp list"
Write-Host "  任意终端   ：node `"$Dir\router.mjs`" decide `"帮我写个快速排序`""
