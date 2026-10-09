#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// agent-model-router · MCP server（零依赖，stdio，换行分隔 JSON-RPC）
// 暴露工具：
//   route_prompt  — 输入提示词，返回模型 + 思考强度推荐（完整决策报告）
//   list_models   — 列出当前模型库
// 任何支持 MCP 的 Agent（Claude Code / Kimi Code / Codex / Cursor …）
// 只需把本文件注册为 stdio server 即可。
// ─────────────────────────────────────────────────────────────────
import { createInterface } from 'node:readline'
import { decide } from './router.mjs'

const SERVER_INFO = { name: 'agent-model-router', version: '1.0.0' }
const PROTOCOL_VERSION = '2024-11-05'

const TOOLS = [
  {
    name: 'route_prompt',
    description:
      '对一条提示词做模型路由决策：分析任务类型/复杂度/模态需求，推荐最合适的模型与思考强度（Kimi 系返回 reasoning_effort 档位，Claude 系返回 thinking 开关）。带置信度与门控说明。开始非平凡任务前调用一次。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '用户的原始提示词 / 任务描述' },
        profile: { type: 'string', enum: ['kimi', 'claude'], description: '模型库：kimi（默认）或 claude' },
        preset: { type: 'string', enum: ['quality', 'balanced', 'budget', 'speed'], description: '决策偏好，默认 balanced' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'list_models',
    description: '列出指定模型库中的全部模型及其能力分、价格、思考控制方式。',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', enum: ['kimi', 'claude'], description: '模型库：kimi（默认）或 claude' },
      },
    },
  },
]

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
}
function replyError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n')
}

function textResult(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] }
}

function handle(msg) {
  const { id, method, params } = msg
  switch (method) {
    case 'initialize':
      reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO })
      break
    case 'notifications/initialized':
    case 'initialized':
      break // 通知，无需回复
    case 'ping':
      reply(id, {})
      break
    case 'tools/list':
      reply(id, { tools: TOOLS })
      break
    case 'tools/call': {
      try {
        const name = params?.name
        const a = params?.arguments ?? {}
        if (name === 'route_prompt') {
          if (!a.prompt) return replyError(id, -32602, 'missing required argument: prompt')
          const report = decide(a.prompt, { profile: a.profile ?? 'kimi', preset: a.preset ?? 'balanced' })
          reply(id, textResult(report))
        } else if (name === 'list_models') {
          const report = decide('ping', { profile: a.profile ?? 'kimi' }) // 仅为取模型库
          reply(id, textResult(report.ranking.map(({ id: mid, name, tier, thinking, note }) => ({ id: mid, name, tier, thinking, note }))))
        } else {
          replyError(id, -32601, `unknown tool: ${name}`)
        }
      } catch (e) {
        replyError(id, -32603, `internal error (fail-open): ${e?.message ?? e}`)
      }
      break
    }
    default:
      if (id !== undefined) replyError(id, -32601, `method not found: ${method}`)
  }
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const t = line.trim()
  if (!t) return
  try {
    handle(JSON.parse(t))
  } catch {
    // 无法解析的行直接忽略（fail-open）
  }
})
