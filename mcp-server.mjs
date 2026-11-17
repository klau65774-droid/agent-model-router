#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// agent-model-router · MCP server（零依赖，stdio，换行分隔 JSON-RPC）
// 暴露工具：
//   route_prompt  — 输入提示词，返回模型 + 思考强度推荐（完整决策报告）
//   list_models   — 列出当前模型库
//   record_feedback — 为本地路由记录追加执行结果或偏好
// 任何支持 MCP 的 Agent（Claude Code / Kimi Code / Codex / Cursor …）
// 只需把本文件注册为 stdio server 即可。
// ─────────────────────────────────────────────────────────────────
import { createInterface } from 'node:readline'
import { decide, modelsFor, readConfig } from './router.mjs'
import { CONTEXT_SCHEMA, isObject } from './lib/context.mjs'
import { FEEDBACK_SCHEMA, recordFeedback, recordRoute } from './lib/feedback.mjs'

const SERVER_INFO = { name: 'agent-model-router', version: '1.1.0' }
const PROTOCOL_VERSION = '2024-11-05'

function loadServerConfig(args) {
  if (args.length === 0) return {}
  if (args.length !== 2 || args[0] !== '--config') throw new TypeError('Use mcp-server.mjs [--config path]')
  return readConfig(args[1])
}

let config
try {
  config = loadServerConfig(process.argv.slice(2))
} catch (error) {
  console.error(`[model-router] ${error.message}`)
  process.exit(1)
}

const TOOLS = [
  {
    name: 'route_prompt',
    description:
      '本地路由建议，包含任务画像、候选、未校准指标与 HOLD 变化。提供 prompt 或结构化目标；record 为 true 时返回用于反馈的 routeId。',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '用户的原始提示词 / 任务描述' },
        profile: { type: 'string', enum: ['kimi', 'claude'], description: '模型库：kimi（默认）或 claude' },
        preset: { type: 'string', enum: ['quality', 'balanced', 'budget', 'speed'], description: '决策偏好，默认 balanced' },
        context: CONTEXT_SCHEMA,
        record: { type: 'boolean', default: false },
      },
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
  {
    name: 'record_feedback',
    description: '为已记录的 routeId 写入本地执行结果或采纳偏好。指标须注明 measured、estimated 或 missing。',
    inputSchema: FEEDBACK_SCHEMA,
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
        if (!isObject(a)) return replyError(id, -32602, 'tool arguments must be an object')
        if (name === 'route_prompt') {
          if (a.prompt !== undefined && typeof a.prompt !== 'string') throw new TypeError('prompt must be a string')
          if (!a.prompt?.trim() && !a.context?.goal && !a.context?.taskType) throw new TypeError('provide a prompt or a structured goal')
          if (a.record !== undefined && typeof a.record !== 'boolean') throw new TypeError('record must be a boolean')
          const report = decide(a.prompt, {
            profile: a.profile ?? config.profile, preset: a.preset ?? config.preset, models: config.models, context: a.context,
          })
          reply(id, textResult(a.record ? recordRoute(report, { entrypoint: 'mcp' }) : report))
        } else if (name === 'list_models') {
          const models = config.models ?? modelsFor(a.profile ?? config.profile)
          reply(id, textResult(models.map(({ id: mid, name, tier, thinking, note }) => ({ id: mid, name, tier, thinking, note }))))
        } else if (name === 'record_feedback') {
          reply(id, textResult(recordFeedback(a)))
        } else {
          replyError(id, -32601, `unknown tool: ${name}`)
        }
      } catch (e) {
        if (e instanceof TypeError) replyError(id, -32602, e.message)
        else replyError(id, -32603, 'Unable to complete the local operation')
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
