import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isObject } from './context.mjs'

const SCHEMA_VERSION = 1
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDENTIFIER = /^[a-zA-Z0-9_.:/-]{1,120}$/
const KINDS = ['measured', 'estimated', 'missing']
const STATUSES = ['success', 'failure', 'unknown']
const CRITERION_SOURCES = ['test', 'validator', 'human_review', 'user_confirmation']
const METRIC_KEYS = ['retries', 'inputTokens', 'outputTokens', 'latencyMs', 'costUsd']

export const FEEDBACK_SCHEMA = {
  type: 'object',
  required: ['routeId'],
  properties: {
    routeId: { type: 'string', pattern: UUID.source },
    actualModel: { type: 'string', pattern: IDENTIFIER.source },
    adopted: { type: 'boolean', description: 'Whether the user preferred the recommendation' },
    outcome: {
      type: 'object', required: ['status'],
      properties: {
        status: { type: 'string', enum: STATUSES },
        criterion: {
          type: 'object', required: ['description', 'source'],
          properties: {
            description: { type: 'string', minLength: 1, maxLength: 280 },
            source: { type: 'string', enum: CRITERION_SOURCES },
          },
        },
      },
    },
    metrics: {
      type: 'object',
      properties: Object.fromEntries(METRIC_KEYS.map(key => [key, {
        type: 'object', required: ['kind', 'value'],
        properties: {
          kind: { type: 'string', enum: KINDS },
          value: { type: [key.endsWith('Tokens') || key === 'retries' ? 'integer' : 'number', 'null'], minimum: 0 },
        },
      }])),
    },
  },
}

export function feedbackLogPath(path) {
  return resolve(path ?? (process.env.AMR_FEEDBACK_LOG || join(homedir(), '.agent-model-router', 'feedback.jsonl')))
}

function appendEvent(path, fields) {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify({
    schemaVersion: SCHEMA_VERSION, timestamp: new Date().toISOString(), ...fields,
  }) + '\n', { encoding: 'utf8', mode: 0o600 })
}

export function recordRoute(report, { mode = 'recommendation', entrypoint, logPath } = {}) {
  const routeId = randomUUID()
  try {
    const selected = report.recommendation
    appendEvent(feedbackLogPath(logPath), {
      event: 'route', routeId, mode, entrypoint, policyVersion: report.policyVersion,
      modelProfile: typeof report.modelProfile === 'string' && IDENTIFIER.test(report.modelProfile) ? report.modelProfile : null,
      preset: ['quality', 'balanced', 'budget', 'speed'].includes(report.preset) ? report.preset : 'balanced',
      taskType: report.profile.taskType.value,
      classificationConfidence: {
        value: report.profile.taskType.confidence,
        kind: report.profile.taskType.confidenceKind,
        calibration: report.profile.taskType.calibration,
      },
      complexity: report.profile.complexity.value,
      ambiguity: report.profile.ambiguity.value,
      failureImpact: report.profile.failureImpact.value,
      hold: report.profile.hold,
      recommendation: selected ? {
        model: selected.model, tier: report.ranking[0].tier, effort: selected.effort,
        score: selected.score, scoreKind: selected.scoreKind, calibration: selected.calibration,
      } : null,
    })
    return { ...report, routeId, recording: { status: 'recorded' } }
  } catch {
    return { ...report, routeId: null, recording: { status: 'failed', reason: '无法写入本地反馈日志' } }
  }
}

function normalizeOutcome(input) {
  const status = input === undefined ? 'unknown' : input?.status
  const criterion = input?.criterion
  if ((input !== undefined && !isObject(input)) || !STATUSES.includes(status)) {
    throw new TypeError('Invalid outcome.status')
  }
  if (status === 'unknown' && criterion === undefined) return { status, criterion: null }
  if (!isObject(criterion) || typeof criterion.description !== 'string' ||
      !criterion.description.trim() || criterion.description.trim().length > 280 ||
      !CRITERION_SOURCES.includes(criterion.source)) {
    throw new TypeError('outcome.criterion requires a description and a supported source')
  }
  return { status, criterion: { description: criterion.description.trim(), source: criterion.source } }
}

function normalizeMetrics(input = {}) {
  if (!isObject(input)) throw new TypeError('metrics must be an object')
  return Object.fromEntries(METRIC_KEYS.map(key => {
    const metric = Object.hasOwn(input, key) ? input[key] : { value: null, kind: 'missing' }
    if (!isObject(metric) || !KINDS.includes(metric.kind) || (metric.kind === 'missing'
      ? metric.value !== null
      : !Number.isFinite(metric.value) || metric.value < 0)) {
      throw new TypeError(`Invalid metric: ${key}`)
    }
    if (metric.value !== null && (key.endsWith('Tokens') || key === 'retries') && !Number.isSafeInteger(metric.value)) {
      throw new TypeError(`Metric ${key} must be an integer`)
    }
    return [key, { value: metric.value, kind: metric.kind }]
  }))
}

function normalizeFeedback(input) {
  if (!isObject(input) || typeof input.routeId !== 'string' || !UUID.test(input.routeId)) {
    throw new TypeError('A valid routeId is required')
  }
  const { actualModel, adopted } = input
  if (actualModel !== undefined && (typeof actualModel !== 'string' || !IDENTIFIER.test(actualModel))) {
    throw new TypeError('Invalid actualModel')
  }
  if (adopted !== undefined && typeof adopted !== 'boolean') throw new TypeError('adopted must be a boolean')

  const outcome = normalizeOutcome(input.outcome)
  const metrics = normalizeMetrics(input.metrics)
  if (!actualModel && (outcome.status !== 'unknown' || adopted === undefined ||
      Object.values(metrics).some(metric => metric.kind !== 'missing'))) {
    throw new TypeError('An actualModel is required for execution feedback; preference-only feedback requires adopted')
  }
  return { routeId: input.routeId.toLowerCase(), adopted: adopted ?? null, actualModel: actualModel ?? null, outcome, metrics }
}

export function readFeedbackLog(path) {
  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { routes: new Map(), feedback: new Map(), malformed: 0, orphaned: 0, missing: true }
    throw error
  }
  const routes = new Map()
  const feedback = new Map()
  let malformed = 0
  let orphaned = 0
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event?.schemaVersion !== SCHEMA_VERSION || typeof event.routeId !== 'string' || !UUID.test(event.routeId)) {
        malformed++
        continue
      }
      const id = event.routeId.toLowerCase()
      if (event.event === 'route' && ['recommendation', 'shadow'].includes(event.mode) &&
          typeof event.policyVersion === 'string' && Object.hasOwn(event, 'recommendation') &&
          (event.recommendation === null || typeof event.recommendation?.model === 'string') && !routes.has(id)) {
        routes.set(id, event)
      } else if (event.event === 'feedback' && routes.has(id)) {
        if (event.policyVersion !== routes.get(id).policyVersion) throw new TypeError('Mismatched policy version')
        const fields = normalizeFeedback({
          ...event, actualModel: event.actualModel ?? undefined, adopted: event.adopted ?? undefined,
          outcome: { ...event.outcome, criterion: event.outcome?.criterion ?? undefined },
        })
        const prior = feedback.get(id)
        feedback.set(id, {
          adopted: fields.adopted ?? prior?.adopted ?? null,
          execution: fields.actualModel ? fields : prior?.execution ?? null,
        })
      } else if (event.event === 'feedback') {
        orphaned++
      } else {
        malformed++
      }
    } catch {
      malformed++
    }
  }
  return { routes, feedback, malformed, orphaned }
}

export function recordFeedback(input, logPath) {
  const fields = normalizeFeedback(input)
  const path = feedbackLogPath(logPath)
  const { routes } = readFeedbackLog(path)
  const route = routes.get(fields.routeId)
  if (!route) throw new TypeError('routeId was not found in the local feedback log')
  appendEvent(path, { event: 'feedback', policyVersion: route.policyVersion, ...fields })
  return { recorded: true, routeId: fields.routeId, policyVersion: route.policyVersion }
}
