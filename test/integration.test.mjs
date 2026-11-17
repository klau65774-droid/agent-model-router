import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { decide, modelsFor } from '../router.mjs'
import { readFeedbackLog, recordFeedback, recordRoute } from '../lib/feedback.mjs'
import { executionSummary } from '../eval/evaluate.mjs'

const cwd = fileURLToPath(new URL('../', import.meta.url))

function tempFiles(run) {
  const dir = mkdtempSync(join(tmpdir(), 'amr-test-'))
  const log = join(dir, 'feedback.jsonl')
  try {
    return run({ dir, log })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function runNode(args, log, input = '') {
  const result = spawnSync(process.execPath, args, {
    cwd, input, timeout: 8000, encoding: 'utf8', env: { ...process.env, AMR_FEEDBACK_LOG: log },
  })
  if (result.error) throw result.error
  return result
}

function jsonOutput(processOutput) {
  assert.equal(processOutput.status, 0, processOutput.stderr)
  return JSON.parse(processOutput.stdout)
}

function mcp(calls, log, extraArgs = []) {
  const result = runNode(['mcp-server.mjs', ...extraArgs], log, calls.map(call => JSON.stringify({
    jsonrpc: '2.0', ...call,
  })).join('\n') + '\n')
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim().split(/\r?\n/).map(JSON.parse)
}

function call(id, name, args) {
  return { id, method: 'tools/call', params: { name, arguments: args } }
}

function toolResult(response) {
  assert.ok(response.result, JSON.stringify(response.error))
  return JSON.parse(response.result.content[0].text)
}

test('CLI supports prompt arguments, UTF-8 stdin, models and policy without writing by default', () => tempFiles(({ log }) => {
  const report = jsonOutput(runNode(['router.mjs', 'decide', '翻译此文本成英语', '--json'], log))
  assert.equal(report.profile.taskType.value, 'translate')
  assert.equal(report.routeId, null)
  const piped = jsonOutput(runNode(['router.mjs', 'decide', '--json'], log, '\ufeffExtract the ticket IDs.'))
  assert.equal(piped.profile.taskType.value, 'extract')
  assert.equal(jsonOutput(runNode(['router.mjs', 'models', '--profile', 'claude'], log)).length, 3)
  const { status, stdout } = runNode(['router.mjs', 'policy'], log)
  assert.equal(status, 0)
  assert.match(stdout, /HOLD/)
  assert.equal(existsSync(log), false)
}))

test('CLI accepts context files and reports missing or invalid files', () => tempFiles(({ log, dir }) => {
  const contextPath = join(dir, 'context.json')
  writeFileSync(contextPath, JSON.stringify({ goal: 'Extract the order IDs.', inputTokens: 50 }))
  const report = jsonOutput(runNode(['router.mjs', 'decide', '--json', '--context', contextPath], log))
  assert.equal(report.profile.taskType.value, 'extract')
  assert.equal(report.profile.estTokensIn, 50)
  const bad = runNode(['router.mjs', 'decide', 'test', '--context', join(dir, 'missing.json')], log)
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /--context/)
}))

test('Hook preserves protocol and fail-open behavior, including log and option errors', () => tempFiles(({ dir, log }) => {
  for (const input of ['{bad', '{"prompt":"hi"}', '{"prompt":"long enough","context":[]}']) {
    assert.deepEqual(jsonOutput(runNode(['router.mjs', 'hook'], log, input)), {})
  }
  const prompt = JSON.stringify({ prompt: 'Can you help with this?' })
  const ordinary = jsonOutput(runNode(['router.mjs', 'hook', '--profile', 'claude'], log, prompt))
  assert.equal(ordinary.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  assert.match(ordinary.hookSpecificOutput.additionalContext, /lite → pro/)
  assert.equal(existsSync(log), false)
  const blocked = jsonOutput(runNode(['router.mjs', 'hook', '--record'], dir, prompt))
  assert.match(blocked.hookSpecificOutput.additionalContext, /推荐模型/)
  const recorded = jsonOutput(runNode(['router.mjs', 'hook', '--record'], log, prompt))
  assert.match(recorded.hookSpecificOutput.additionalContext, /routeId=[a-f0-9-]{36}/)
  assert.equal(readFeedbackLog(log).routes.size, 1)
  const structured = JSON.stringify({ context: { goal: 'Translate the header to Chinese.' } })
  assert.match(jsonOutput(runNode(['router.mjs', 'hook'], log, structured)).hookSpecificOutput.additionalContext, /translate/)
  assert.deepEqual(jsonOutput(runNode(['router.mjs', 'hook', '--config'], log, prompt)), {})
}))

test('MCP retains initialization, model listing and route_prompt; supports opt-in recording', () => tempFiles(({ log }) => {
  const [init, tools, old, models, bad, optIn] = mcp([
    { id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    call(3, 'route_prompt', { prompt: 'Review this PR.', profile: 'claude' }),
    call(4, 'list_models', { profile: 'claude' }),
    call(5, 'route_prompt', { prompt: 'Test', context: { inputTokens: -1 } }),
    call(6, 'route_prompt', { context: { goal: 'Extract IDs.' }, record: true }),
  ], log)
  assert.equal(init.result.protocolVersion, '2024-11-05')
  assert.deepEqual(tools.result.tools.map(item => item.name), ['route_prompt', 'list_models', 'record_feedback'])
  assert.equal(toolResult(old).profile.taskType.value, 'code')
  assert.equal(toolResult(old).routeId, null)
  assert.equal(toolResult(models).length, 3)
  assert.equal(bad.error.code, -32602)
  const report = toolResult(optIn)
  assert.equal(report.profile.taskType.value, 'extract')
  assert.match(report.routeId, /^[a-f0-9-]{36}$/)
  const [saved] = mcp([call(7, 'record_feedback', { routeId: report.routeId, adopted: true })], log)
  assert.equal(toolResult(saved).recorded, true)
  assert.equal(readFeedbackLog(log).feedback.get(report.routeId).execution, null)
}))

test('MCP applies host model configuration to enforce required tools', () => tempFiles(({ dir, log }) => {
  const configPath = join(dir, 'router.json')
  writeFileSync(configPath, JSON.stringify({ models: [{ ...modelsFor()[1], tools: ['web'] }] }))
  const [res] = mcp([call(1, 'route_prompt', {
    prompt: 'Fetch today’s exchange rate.', context: { requiredTools: ['web'] },
  })], log, ['--config', configPath])
  assert.equal(toolResult(res).recommendation.model, 'kimi-k2.8-preview')
}))

test('local feedback links routes, preserves metric provenance and drops private request fields', () => tempFiles(({ log }) => {
  const marker = 'private_task_material_123'
  const route = jsonOutput(runNode(['router.mjs', 'decide', `Translate this: "${marker}"`, '--json', '--record'], log))
  assert.ok(route.routeId)
  const payload = {
    routeId: route.routeId,
    actualModel: route.recommendation.model,
    adopted: true,
    outcome: { status: 'success', criterion: { description: 'Translation validator passed', source: 'validator' } },
    metrics: {
      retries: { value: 0, kind: 'measured' },
      inputTokens: { value: 40, kind: 'estimated' },
      latencyMs: { value: 175, kind: 'measured' },
    },
    prompt: marker,
  }
  const ack = jsonOutput(runNode(['router.mjs', 'feedback'], log, JSON.stringify(payload)))
  assert.equal(ack.policyVersion, route.policyVersion)
  const feedback = readFeedbackLog(log).feedback.get(route.routeId)
  assert.deepEqual(feedback.execution.metrics.inputTokens, { value: 40, kind: 'estimated' })
  assert.deepEqual(feedback.execution.metrics.costUsd, { value: null, kind: 'missing' })
  assert.equal(feedback.execution.outcome.criterion.source, 'validator')
  assert.equal(readFileSync(log, 'utf8').includes(marker), false)
}))

test('feedback rejects unknown routes, missing success criteria and malformed metrics', () => tempFiles(({ log }) => {
  const report = recordRoute(decide('Translate the title.'), { logPath: log, entrypoint: 'cli' })
  const { routeId } = report
  const actualModel = report.recommendation.model
  assert.throws(() => recordFeedback({ routeId, actualModel, outcome: { status: 'success' } }, log), /criterion/)
  assert.throws(() => recordFeedback({ routeId, outcome: { status: 'failure', criterion: { description: 'test', source: 'test' } } }, log), /actualModel/)
  assert.throws(() => recordFeedback({ routeId, actualModel, metrics: { retries: { value: 1.5, kind: 'measured' } } }, log), /integer/)
  assert.throws(() => recordFeedback({ routeId, actualModel, outcome: { status: null } }, log), /status/)
  assert.throws(() => recordFeedback({ routeId: '12345678-1234-5678-90ab-1234567890ab', adopted: false }, log), /not found/)
  assert.equal(readFeedbackLog(log).feedback.size, 0)
}))

test('shadow mode records only the route ID on stdout and fails visibly if writing is impossible', () => tempFiles(({ dir, log }) => {
  const shadow = runNode(['router.mjs', 'decide', 'Translate this title.', '--shadow'], log)
  assert.equal(shadow.status, 0)
  assert.match(shadow.stdout, /^\[shadow\] 已记录 routeId=[a-f0-9-]{36}/)
  assert.doesNotMatch(shadow.stdout, /kimi/i)
  const route = [...readFeedbackLog(log).routes.values()][0]
  assert.equal(route.mode, 'shadow')
  const failed = runNode(['router.mjs', 'decide', 'Translate this title.', '--shadow'], dir)
  assert.equal(failed.status, 1)
  assert.equal(failed.stdout, '')
  const ordinary = jsonOutput(runNode(['router.mjs', 'decide', 'Translate this title.', '--record', '--json'], dir))
  assert.equal(ordinary.recording.status, 'failed')
  assert.equal(ordinary.routeId, null)
  assert.ok(ordinary.recommendation)
}))

test('execution aggregation counts matched runs only and ignores estimated costs', () => tempFiles(({ log }) => {
  const report = decide('Translate a subject line.')
  function route(mode, policyVersion) {
    return recordRoute({ ...report, policyVersion }, { mode, entrypoint: 'cli', logPath: log }).routeId
  }
  function execution(routeId, status, ms, cost, actualModel = report.recommendation.model) {
    recordFeedback({
      routeId, actualModel, outcome: { status, criterion: { description: 'Expected translated title', source: 'test' } },
      metrics: { latencyMs: { value: ms, kind: 'measured' }, costUsd: cost },
    }, log)
  }
  const first = route('recommendation', 'previous-test-policy')
  const second = route('recommendation', report.policyVersion)
  const third = route('recommendation', report.policyVersion)
  execution(first, 'failure', 90, { value: 0.2, kind: 'measured' })
  execution(second, 'success', 50, { value: 0.1, kind: 'measured' })
  execution(third, 'failure', 110, { value: 0.4, kind: 'estimated' })
  execution(second, 'success', 50, { value: 0.1, kind: 'measured' }) // retried submission
  recordFeedback({ routeId: second, adopted: true }, log)
  recordFeedback({ routeId: route('recommendation', report.policyVersion), adopted: true }, log)
  execution(route('shadow', report.policyVersion), 'success', 9999, { value: 10, kind: 'measured' })
  execution(route('recommendation', report.policyVersion), 'success', 9999, { value: 10, kind: 'measured' }, 'other-model')

  const summary = executionSummary(readFeedbackLog(log))
  assert.equal(summary.policies.length, 2)
  assert.deepEqual(summary.policies[1], {
    version: report.policyVersion, executions: 2, successCount: 1, knownCount: 2,
    averageCostUsd: 0.1, costCount: 1, latencyP50: 50, latencyP95: 110, latencyCount: 2,
  })
  assert.equal(summary.shadowRoutes, 1)
  assert.equal(summary.adoptionOnly, 1)
  assert.equal(summary.unmatchedExecutions, 1)
  const replay = runNode(['eval/replay.mjs', '--split', 'tuning', '--feedback', log], log)
  assert.equal(replay.status, 0, replay.stderr)
  assert.match(replay.stdout, /previous-test-policy/)
  assert.match(replay.stdout, /50 \/ 110/)
}))

test('replay reports malformed or orphaned events and rejects a missing explicit log', () => tempFiles(({ log }) => {
  const args = ['eval/replay.mjs', '--split', 'tuning', '--feedback', log]
  const missing = runNode(args, log)
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /does not exist/)
  appendFileSync(log, 'invalid json\n' + JSON.stringify({
    schemaVersion: 1, event: 'feedback', routeId: '12345678-1234-5678-90ab-1234567890ab',
  }) + '\n')
  recordRoute(decide('Extract order IDs.'), { logPath: log, entrypoint: 'cli' })
  const report = runNode(args, log)
  assert.equal(report.status, 0, report.stderr)
  assert.match(report.stdout, /1 条无效记录、1 条未关联反馈/)
}))
