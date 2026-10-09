#!/usr/bin/env node
// 把 agent-model-router 合并写入 MCP 配置文件（存在则合并，先备份）
// 用法: node scripts/register-mcp.mjs <configPath> <routerDir>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [configPath, routerDir] = process.argv.slice(2)
if (!configPath || !routerDir) {
  console.error('用法: node register-mcp.mjs <configPath> <routerDir>')
  process.exit(1)
}

const serverEntry = {
  transport: 'stdio',
  command: 'node',
  args: [resolve(routerDir, 'mcp-server.mjs').replace(/\\/g, '/')],
}

let cfg = { mcpServers: {} }
if (existsSync(configPath)) {
  try {
    cfg = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch {
    // 已有文件但 JSON 损坏：备份后报错退出，不破坏用户配置
    copyFileSync(configPath, configPath + '.corrupt.bak')
    console.error(`! 现有配置 JSON 无法解析，已备份为 ${configPath}.corrupt.bak，请人工处理后重试`)
    process.exit(1)
  }
  copyFileSync(configPath, configPath + '.bak')
}
cfg.mcpServers ??= {}
const existed = Boolean(cfg.mcpServers['agent-model-router'])
cfg.mcpServers['agent-model-router'] = serverEntry

mkdirSync(dirname(configPath), { recursive: true })
writeFileSync(configPath, JSON.stringify(cfg, null, 2) + '\n')
console.log(`✓ ${existed ? '已更新' : '已注册'} agent-model-router → ${configPath}（备份 .bak）`)
process.exit(0)
