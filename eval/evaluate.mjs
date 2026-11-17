import { readFileSync } from 'node:fs'
import { decide, modelsFor } from '../router.mjs'
import { BASE_COMMIT, BASE_SOURCE_SHA256, caseInput, EFFORTS, loadCases, prediction, TIERS } from './fixtures.mjs'

function passesHardConstraints(model, hard = {}) {
  const { budget } = hard
  return Boolean(model) &&
    (hard.modalities ?? []).every(modality => model.modalities?.[modality] === true) &&
    (hard.tools ?? []).every(tool => Array.isArray(model.tools) && model.tools.includes(tool)) &&
    model.contextK * 1000 >= (hard.minContextTokens ?? 0) &&
    (!budget || (budget.inputTokens * model.priceIn + budget.outputTokens * model.priceOut) / 1_000_000 <= budget.maxEstimatedUsd)
}

function outsideBand(value, acceptable, scale) {
  const index = scale.indexOf(value)
  if (index < 0) throw new Error(`Unknown recommendation level: ${value}`)
  return {
    under: index < scale.indexOf(acceptable[0]),
    over: index > scale.indexOf(acceptable.at(-1)),
  }
}

function grade(pred, label, models) {
  const feasible = models.some(model => passesHardConstraints(model, label.hard))
  const selected = pred.model === null ? null : models.find(model => model.id === pred.model)
  const violation = pred.model !== null && !passesHardConstraints(selected, label.hard)
  const missed = feasible && pred.model === null
  const comparable = pred.model !== null && !violation
  const tier = comparable ? outsideBand(pred.tier, label.acceptableTiers, TIERS) : null
  const effort = comparable ? outsideBand(pred.effort, label.acceptableEfforts, EFFORTS) : null
  return {
    ...pred, typeCorrect: pred.type === label.type, violation, missed, comparable,
    over: tier?.over || effort?.over || false,
    under: tier?.under || effort?.under || false,
  }
}

function readBaseline(cases, checksum) {
  const baseline = JSON.parse(readFileSync(new URL('baseline.json', import.meta.url), 'utf8'))
  if (baseline.schemaVersion !== 2 || baseline.fixtureSha256 !== checksum ||
      baseline.sourceSha256 !== BASE_SOURCE_SHA256 || baseline.baseCommit !== BASE_COMMIT ||
      !['kimi', 'claude'].every(profile => Array.isArray(baseline.catalogs?.[profile])) ||
      baseline.rows.length !== cases.length || !cases.every((row, index) => row.id === baseline.rows[index].id)) {
    throw new Error('Baseline does not match the pinned source and fixture set. Rebuild from the pinned commit.')
  }
  return { catalogs: baseline.catalogs, predictions: new Map(baseline.rows.map(({ id, ...pred }) => [id, pred])) }
}

export function replay({ split, check = false } = {}) {
  const { cases, checksum } = loadCases()
  const baseline = readBaseline(cases, checksum)
  const regressions = []
  const results = []
  for (const row of cases) {
    if (split && split !== row.split) continue
    const { prompt, options } = caseInput(row)
    const models = options.models ?? modelsFor(options.profile)
    const report = decide(prompt, options)
    if (check && JSON.stringify(report) !== JSON.stringify(decide(prompt, options))) {
      regressions.push(`${row.id}: fixed input was not deterministic`)
    }
    const old = grade(baseline.predictions.get(row.id), row.label, options.models ?? baseline.catalogs[options.profile])
    const current = grade(prediction(report), row.label, models)
    if (check && row.split === 'holdout') {
      if ((!old.violation && current.violation) || current.missed) regressions.push(`${row.id}: hard constraint or feasible recommendation regression`)
      if (row.label.critical && (
        (old.typeCorrect && !current.typeCorrect) ||
        (!old.violation && current.violation) ||
        (old.comparable && !old.under && current.under) ||
        (old.comparable && !old.over && current.over)
      )) regressions.push(`${row.id}: critical task regression`)
    }
    results.push({ row, old, current })
  }
  return { results, regressions, checksum }
}

export function summary(results, policy) {
  return results.reduce((sum, result) => {
    const entry = result[policy]
    sum.count++
    for (const key of ['typeCorrect', 'violation', 'missed', 'comparable', 'over', 'under']) sum[key] += Number(entry[key])
    return sum
  }, { count: 0, typeCorrect: 0, violation: 0, missed: 0, comparable: 0, over: 0, under: 0 })
}

function quantile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null
}

function measured(executions, name) {
  return executions.map(execution => execution.metrics[name]).filter(metric => metric.kind === 'measured').map(metric => metric.value)
}

export function executionSummary(log) {
  const groups = new Map()
  let shadowRoutes = 0
  let unmatchedExecutions = 0
  let adoptionOnly = 0
  for (const [id, route] of log.routes) {
    const result = log.feedback.get(id)
    if (route.mode === 'shadow') {
      shadowRoutes++
      continue
    }
    if (!groups.has(route.policyVersion)) groups.set(route.policyVersion, [])
    if (result?.adopted !== null && result?.adopted !== undefined && !result.execution) adoptionOnly++
    if (!result?.execution) continue
    if (result.execution.actualModel !== route.recommendation?.model) {
      unmatchedExecutions++
      continue
    }
    groups.get(route.policyVersion).push(result.execution)
  }
  return {
    shadowRoutes, unmatchedExecutions, adoptionOnly,
    policies: [...groups].map(([version, executions]) => {
      const known = executions.filter(item => item.outcome.status !== 'unknown')
      const costs = measured(executions, 'costUsd')
      const latencies = measured(executions, 'latencyMs')
      return {
        version, executions: executions.length,
        successCount: known.filter(item => item.outcome.status === 'success').length,
        knownCount: known.length,
        averageCostUsd: costs.length ? costs.reduce((sum, value) => sum + value, 0) / costs.length : null,
        costCount: costs.length,
        latencyP50: quantile(latencies, 0.5), latencyP95: quantile(latencies, 0.95), latencyCount: latencies.length,
      }
    }),
  }
}
