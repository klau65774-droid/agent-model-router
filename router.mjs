#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isObject } from './lib/context.mjs'
import { analyze } from './lib/task-profile.mjs'
import { recordFeedback, recordRoute } from './lib/feedback.mjs'

export { analyze }
export const POLICY_VERSION = 'rules-v2.0.0'

// ─── 模型库（快照 2026-10，可用 --config 覆盖/扩展） ──────────────
const MODEL_PROFILES = {
  kimi: [
    {
      id: 'kimi-k3', name: 'Kimi K3', tier: 'flagship',
      caps: { reasoning: 9.7, coding: 9.6, chinese: 9.6, writing: 9.5, agentic: 9.5 },
      modalities: { image: true, video: true }, contextK: 1024,
      priceIn: 3.0, priceOut: 15.0, speedTps: 38, openWeights: true,
      thinking: 'effort', effortDefault: 'max',
      note: '2.8T 旗舰，始终推理，AA 指数 43.6 全球第 3；缓存命中输入 $0.30',
    },
    {
      id: 'kimi-k2.8-preview', name: 'Kimi K2.8 Preview', tier: 'pro',
      caps: { reasoning: 9.3, coding: 9.3, chinese: 9.5, writing: 9.3, agentic: 9.2 },
      modalities: { image: true, video: true }, contextK: 1024,
      priceIn: 1.0, priceOut: 4.0, speedTps: 70, openWeights: false,
      thinking: 'effort', effortDefault: 'max',
      note: '低成本主力，官方称接近 K3；1M 上下文日常首选',
    },
    {
      id: 'kimi-k2.7-code', name: 'Kimi K2.7 Code', tier: 'pro',
      caps: { reasoning: 9.1, coding: 9.4, chinese: 9.5, writing: 8.8, agentic: 9.2 },
      modalities: { image: true, video: true }, contextK: 256,
      priceIn: 0.95, priceOut: 4.0, speedTps: 60, openWeights: true,
      thinking: 'always',
      note: '编码专用，Code Bench v2 +21.8%（官方）；始终思考不可调',
    },
    {
      id: 'kimi-k2.7-code-highspeed', name: 'Kimi K2.7 Code Highspeed', tier: 'pro',
      caps: { reasoning: 9.1, coding: 9.4, chinese: 9.5, writing: 8.8, agentic: 9.2 },
      modalities: { image: true, video: true }, contextK: 256,
      priceIn: 1.9, priceOut: 8.0, speedTps: 110, openWeights: false,
      thinking: 'always',
      note: 'K2.7 Code 高速版，同模型更快，价格 ×2',
    },
    {
      id: 'kimi-k2.6', name: 'Kimi K2.6', tier: 'pro',
      caps: { reasoning: 8.9, coding: 9.0, chinese: 9.5, writing: 9.2, agentic: 9.0 },
      modalities: { image: true, video: false }, contextK: 256,
      priceIn: 0.95, priceOut: 4.0, speedTps: 80, openWeights: true,
      thinking: 'binary',
      note: '思考可开关（disabled 省钱）；SWE-bench 60.4%；开源',
    },
  ],
  claude: [
    {
      id: 'claude-opus-4.6', name: 'Claude Opus 4.6', tier: 'flagship',
      caps: { reasoning: 9.8, coding: 9.8, chinese: 9.4, writing: 9.6, agentic: 9.7 },
      modalities: { image: true, video: false }, contextK: 1000,
      priceIn: 5.0, priceOut: 25.0, speedTps: 67, openWeights: false,
      thinking: 'binary',
      note: 'SWE-bench 80.9%，复杂重构 / Agent 标杆',
    },
    {
      id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', tier: 'pro',
      caps: { reasoning: 9.3, coding: 9.6, chinese: 9.2, writing: 9.4, agentic: 9.5 },
      modalities: { image: true, video: false }, contextK: 1000,
      priceIn: 3.0, priceOut: 15.0, speedTps: 78, openWeights: false,
      thinking: 'binary',
      note: '性价比旗舰，质量接近 Opus、速度快一倍',
    },
    {
      id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', tier: 'lite',
      caps: { reasoning: 8.2, coding: 8.6, chinese: 8.8, writing: 8.7, agentic: 8.6 },
      modalities: { image: true, video: false }, contextK: 200,
      priceIn: 1.0, priceOut: 5.0, speedTps: 120, openWeights: false,
      thinking: 'binary',
      note: '轻量 Agent 链路，指令遵循稳定',
    },
  ],
}

const TASK_NEED_WEIGHTS = {
  code: { reasoning: 0.25, coding: 0.45, chinese: 0.05, writing: 0.0, agentic: 0.25 },
  agentic: { reasoning: 0.25, coding: 0.2, chinese: 0.05, writing: 0.0, agentic: 0.5 },
  reasoning: { reasoning: 0.65, coding: 0.1, chinese: 0.1, writing: 0.05, agentic: 0.1 },
  writing: { reasoning: 0.15, coding: 0.0, chinese: 0.25, writing: 0.55, agentic: 0.05 },
  translate: { reasoning: 0.1, coding: 0.0, chinese: 0.45, writing: 0.4, agentic: 0.05 },
  analysis: { reasoning: 0.4, coding: 0.15, chinese: 0.15, writing: 0.15, agentic: 0.15 },
  extract: { reasoning: 0.25, coding: 0.15, chinese: 0.2, writing: 0.05, agentic: 0.35 },
  multimodal: { reasoning: 0.3, coding: 0.05, chinese: 0.15, writing: 0.1, agentic: 0.4 },
  chat: { reasoning: 0.15, coding: 0.0, chinese: 0.3, writing: 0.35, agentic: 0.2 },
  knowledge: { reasoning: 0.35, coding: 0.05, chinese: 0.25, writing: 0.25, agentic: 0.1 },
}

const PRESET_WEIGHTS = {
  quality: { q: 0.7, c: 0.2, s: 0.1 },
  balanced: { q: 0.5, c: 0.3, s: 0.2 },
  budget: { q: 0.3, c: 0.55, s: 0.15 },
  speed: { q: 0.35, c: 0.15, s: 0.5 },
}
const TIER_LEVEL = new Map([['lite', 0], ['pro', 1], ['flagship', 2]])

export function apiParamsFor(model, effort) {
  if (model.thinking === 'effort') return { reasoning_effort: effort }
  if (model.thinking === 'binary') {
    return effort === 'low' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled', keep: 'all' } }
  }
  return {}
}

function estimatedCost(model, { inputTokens, expectedOutputTokens }) {
  if (expectedOutputTokens == null || !Number.isFinite(model.priceIn) || model.priceIn < 0 ||
      !Number.isFinite(model.priceOut) || model.priceOut < 0) return null
  const cost = (inputTokens * model.priceIn + expectedOutputTokens * model.priceOut) / 1_000_000
  return Number.isFinite(cost) ? cost : null
}

function checkModel(model, requirements, cost) {
  const reasons = []
  for (const modality of requirements.modalities) {
    if (model.modalities?.[modality] !== true) reasons.push(`不支持 ${modality} 输入`)
  }
  if (requirements.contextTokens > 0 && (!Number.isFinite(model.contextK) || model.contextK * 1000 < requirements.contextTokens)) {
    reasons.push(`上下文窗口不足，需要 ${requirements.contextTokens} token`)
  }
  const missingTools = requirements.tools.filter(tool => !Array.isArray(model.tools) || !model.tools.includes(tool))
  if (missingTools.length) reasons.push(`未声明工具能力：${missingTools.join('、')}`)
  if (requirements.maxEstimatedUsd !== null) {
    if (cost === null) {
      reasons.push(requirements.expectedOutputTokens === null ? '缺少预计输出 token，无法验证预算' : '缺少有效报价，无法验证预算')
    } else if (cost > requirements.maxEstimatedUsd) {
      reasons.push(`预计费用 $ ${cost} 超出预算 $ ${requirements.maxEstimatedUsd}`)
    }
  }
  return reasons
}

export function rank(profile, models, preset = 'balanced') {
  const need = Object.hasOwn(TASK_NEED_WEIGHTS, profile.taskType.value)
    ? TASK_NEED_WEIGHTS[profile.taskType.value] : TASK_NEED_WEIGHTS.knowledge
  const weights = Object.hasOwn(PRESET_WEIGHTS, preset) ? PRESET_WEIGHTS[preset] : PRESET_WEIGHTS.balanced
  const w = profile.effort.value === 'max' ? PRESET_WEIGHTS.quality : weights
  const complexityBoost = profile.complexity.value / 100
  const requirements = profile.requirements ?? {
    modalities: profile.modality && profile.modality !== 'none' ? [profile.modality] : [],
    tools: [], inputTokens: profile.estTokensIn,
    contextTokens: profile.needsLongContext ? Math.ceil(profile.estTokensIn * 1.6) : 0,
    expectedOutputTokens: null, maxEstimatedUsd: null,
  }
  const filteredOut = []
  const candidates = []
  for (const model of models) {
    const cost = estimatedCost(model, requirements)
    const reasons = checkModel(model, requirements, cost)
    if (reasons.length) filteredOut.push({ id: model.id, why: reasons.join('；'), reasons })
    else candidates.push({ model, cost })
  }
  const maxPrice = Math.max(...candidates.map(({ model }) => model.priceOut ?? 0), 1)
  const maxTps = Math.max(...candidates.map(({ model }) => model.speedTps ?? 0), 1)

  const results = candidates.map(({ model: m, cost }) => {
    let q = 0
    const contributions = []
    for (const [dim, weight] of Object.entries(need)) {
      if (weight <= 0) continue
      const cap = m.caps?.[dim] ?? 0
      q += weight * cap
      contributions.push({ dim, cap, v: weight * cap })
    }
    if (m.tier === 'flagship') q += complexityBoost * 0.4
    if (m.tier === 'lite') q -= complexityBoost * 0.5
    if (profile.chineseRatio > 0.5) q += ((m.caps?.chinese ?? 0) - 8.5) * 0.06
    const quality = Math.max(0, Math.min(10, q)) * 10
    const blended = m.priceIn * 0.75 + m.priceOut * 0.25
    const costScore = Number.isFinite(blended) && blended >= 0
      ? Math.max(2, 100 - (Math.log10(blended + 0.05) + 1.3) / (Math.log10(maxPrice + 0.05) + 1.3) * 100) : 2
    const speedScore = ((m.speedTps ?? 0) / maxTps) * 100
    let total = w.q * quality + w.c * costScore + w.s * speedScore
    if (m.thinking === 'always' && profile.effort.value === 'low') total -= 4
    const highspeedPenalty = /highspeed/i.test(m.id) && preset !== 'speed'
    if (highspeedPenalty) total -= 5

    contributions.sort((a, b) => b.v - a.v)
    const reasons = contributions.slice(0, 2).filter(c => c.v > 0.5).map(c => `${c.dim} ${c.cap.toFixed(1)}`)
    if (m.thinking === 'effort') reasons.push(`可按推荐档 reasoning_effort=${profile.effort.value}`)
    if (m.thinking === 'binary' && profile.effort.value === 'low') reasons.push('简单任务可关闭思考')
    const risks = []
    if (m.thinking === 'always' && profile.effort.value === 'low') risks.push('始终思考，简单任务也可能产生推理 token')
    if (highspeedPenalty) risks.push('速度溢价：适合速度优先或长输出')
    if (m.speedTps < 45) risks.push('输出偏慢')
    if (profile.stakes === 'high' && m.tier !== 'flagship') risks.push('高失败影响，建议人工复核')

    return {
      id: m.id, name: m.name, tier: m.tier,
      total: Math.round(total * 10) / 10, scoreKind: 'heuristic', calibration: 'uncalibrated',
      quality: Math.round(quality), costScore: Math.round(costScore), speedScore: Math.round(speedScore),
      estimatedCostUsd: { value: cost, kind: cost === null ? 'missing' : 'estimated' },
      thinking: m.thinking, apiParams: apiParamsFor(m, profile.effort.value),
      reasons, risks, note: m.note,
    }
  })
  return { ranking: results.sort((a, b) => b.total - a.total), filteredOut }
}

function selected(candidate, effort) {
  return candidate ? { model: candidate.id, tier: candidate.tier, effort, apiParams: candidate.apiParams } : null
}

function applyHold(p, candidates, before) {
  const preferredTier = p.hold ? (p.stakes === 'high' ? 'flagship' : 'pro') : null
  const preferred = preferredTier === null ? [] : candidates.filter(m => TIER_LEVEL.get(m.tier) >= TIER_LEVEL.get(preferredTier))
  const ranking = preferred.length && preferred[0] !== candidates[0]
    ? [...preferred, ...candidates.filter(candidate => !preferred.includes(candidate))]
    : candidates
  const after = selected(ranking[0], p.effort.value)
  const compared = before !== null && after !== null
  const tierRaised = compared && TIER_LEVEL.get(after.tier) > TIER_LEVEL.get(before.tier)
  const effortRaised = compared && p.effort.beforeHold !== p.effort.value
  const apiParamsChanged = compared && JSON.stringify(before.apiParams) !== JSON.stringify(after.apiParams)
  const changes = []
  if (tierRaised) changes.push(`模型档位 ${before.tier} → ${after.tier}`)
  if (effortRaised) changes.push(`思考建议 ${before.effort} → ${after.effort}`)
  if (compared && before.model !== after.model && !tierRaised) changes.push(`首选模型 ${before.model} → ${after.model}`)
  if (p.hold && after && !preferred.length) changes.push(`没有满足硬约束的 ${preferredTier} 档候选`)
  const explanation = !p.hold ? '' : !after ? '硬约束筛选后没有可推荐模型'
    : changes.length ? changes.join('；') : `门控前后的首选均为 ${after.model} / ${after.effort}`
  return {
    ranking,
    gate: { triggered: p.hold, preferredTier, before, after, tierRaised, effortRaised, apiParamsChanged, explanation },
  }
}

export function modelsFor(profile = 'kimi') {
  return Object.hasOwn(MODEL_PROFILES, profile) ? MODEL_PROFILES[profile] : MODEL_PROFILES.kimi
}

export function decide(prompt, { profile = 'kimi', preset = 'balanced', models = null, context } = {}) {
  const p = analyze(prompt, context)
  const modelList = models ?? modelsFor(profile)
  if (!Array.isArray(modelList)) throw new TypeError('models must be an array')
  const ranked = rank(p, modelList, preset)
  const before = p.effort.beforeHold === p.effort.value ? ranked.ranking[0] : rank({
    ...p, effort: { ...p.effort, value: p.effort.beforeHold },
  }, modelList, preset).ranking[0]
  const { ranking, gate } = applyHold(p, ranked.ranking, selected(before, p.effort.beforeHold))
  const top = ranking[0]
  const incomplete = p.requirements.maxEstimatedUsd !== null && p.requirements.expectedOutputTokens === null
  return {
    profile: p,
    preset,
    modelProfile: profile,
    policyVersion: POLICY_VERSION,
    routeId: null,
    recommendation: top ? {
      model: top.id,
      modelName: top.name,
      score: top.total, scoreKind: top.scoreKind, calibration: top.calibration,
      effort: p.effort.value,
      apiParams: top.apiParams,
      thinkingNote: top.thinking === 'always' ? '该模型始终思考，档位不可调'
        : top.thinking === 'binary' ? '思考为开关式，按 apiParams 设置'
          : '按 apiParams 设置思考档位',
      successProbability: { value: null, status: 'uncalibrated', reason: '缺少与任务及模型匹配的标注执行结果' },
    } : null,
    ranking,
    filteredOut: ranked.filteredOut,
    policy: {
      hold: p.hold,
      holdReasons: p.holdReasons,
      rule: '先检查硬约束，HOLD 按可用档位优先，记录首选与思考建议的实际变化。',
      gate,
      constraints: { status: incomplete ? 'incomplete' : top ? 'satisfied' : 'no_eligible_models' },
    },
  }
}

function holdText(report) {
  return report.policy.hold
    ? `HOLD：${report.policy.holdReasons.join('；')}。${report.policy.gate.explanation}`
    : ''
}

function formatReport(r) {
  const p = r.profile
  const lines = [
    `任务画像：${p.taskType.value}（分类依据 ${p.taskType.confidenceKind}，未校准分值 ${p.taskType.confidence}）`,
    `复杂度：${p.complexity.value}/100 ｜ 需求不明确程度：${p.ambiguity.value} ｜ 失败影响：${p.stakes} ｜ 输入 ${p.estTokensIn} tok（${p.requirements.inputTokensKind}）｜ 模态：${p.modalities.join('、') || 'none'}`,
    `推荐思考建议：${p.effort.value.toUpperCase()}（${p.effort.evidence.join('；')}）`,
  ]
  if (p.ambiguity.reasons.length) lines.push(`需补充：${p.ambiguity.missingFields.join('、')}。${p.ambiguity.reasons.join('；')}`)
  if (r.policy.hold) lines.push(holdText(r))
  if (r.recommendation) {
    const rec = r.recommendation
    lines.push('', `★ 首选：${rec.modelName}（启发式综合分 ${rec.score}）`)
    lines.push(`  调用参数：${JSON.stringify(rec.apiParams)}  ${rec.thinkingNote}`, '', '候选排行：')
    for (const [i, m] of r.ranking.entries()) {
      lines.push(`  ${i + 1}. ${m.name}  总分 ${m.total}（契合 ${m.quality} / 省钱 ${m.costScore} / 速度 ${m.speedScore}）`)
      if (m.reasons.length) lines.push(`     ✓ ${m.reasons.join('；')}`)
      if (m.risks.length) lines.push(`     ! ${m.risks.join('；')}`)
    }
  } else {
    lines.push('! 没有满足硬约束的候选')
  }
  if (r.filteredOut.length) lines.push(`已过滤：${r.filteredOut.map(f => `${f.id}（${f.why}）`).join('、')}`)
  if (r.routeId) lines.push(`routeId：${r.routeId}`)
  if (r.recording?.status === 'failed') lines.push(r.recording.reason)
  return lines.join('\n')
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--') {
      args._.push(...argv.slice(i + 1))
      break
    }
    if (!arg.startsWith('--')) {
      args._.push(arg)
      continue
    }
    const key = arg.slice(2)
    if (['json', 'shadow', 'record'].includes(key)) args[key] = true
    else if (['profile', 'preset', 'config', 'context', 'log'].includes(key)) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new TypeError(`Missing value for --${key}`)
      args[key] = argv[++i]
    } else throw new TypeError(`Unknown option --${key}`)
  }
  return args
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').replace(/^\ufeff/u, '')
}

function readJsonFile(path, name) {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\ufeff/u, ''))
  } catch {
    throw new TypeError(`Unable to read valid JSON from ${name}`)
  }
}

export function readConfig(path) {
  const config = path ? readJsonFile(path, '--config') : {}
  if (!isObject(config)) throw new TypeError('--config must contain a JSON object')
  return config
}

function writeExit(str, code = 0) {
  process.stdout.write(str.endsWith('\n') || str === '' ? str : str + '\n', () => process.exit(code))
}

function maybeRecord(report, args, entrypoint) {
  if (!args.shadow && !args.record) return report
  return recordRoute(report, { mode: args.shadow ? 'shadow' : 'recommendation', entrypoint, logPath: args.log })
}

async function runHook(args, options) {
  const payload = JSON.parse(await readStdin() || '{}')
  const prompt = payload.prompt ?? payload.message ?? ''
  const context = Object.hasOwn(payload, 'context') ? payload.context : options.context
  // Preserve the legacy short-message filter for prompt-only hook events.
  if (String(prompt).trim().length < 8 && context === undefined) return writeExit('{}')
  if (!String(prompt).trim() && !context?.goal && !context?.taskType) return writeExit('{}')
  const r = maybeRecord(decide(prompt, { ...options, context }), args, 'hook')
  if (args.shadow || !r.recommendation) return writeExit('{}')
  const rec = r.recommendation
  const detail = `[model-router] 任务=${r.profile.taskType.value}（未校准） 复杂度=${r.profile.complexity.value}/100` +
    ` → 推荐模型 ${rec.modelName}，思考建议 ${rec.effort.toUpperCase()}（调用参数 ${JSON.stringify(rec.apiParams)}）。` +
    (r.policy.hold ? holdText(r) + '。' : '') + (r.routeId ? `routeId=${r.routeId}。` : '')
  writeExit(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: detail + '此建议仅供参考。' },
  }))
}

async function main() {
  const argv = process.argv.slice(2)
  let cmd = argv[0]
  try {
    const args = parseArgs(argv)
    cmd = args._.shift() ?? 'decide'
    if (cmd === 'feedback') {
      const feedback = args._[0] ? readJsonFile(args._[0], 'feedback file') : JSON.parse(await readStdin())
      return writeExit(JSON.stringify(recordFeedback(feedback, args.log), null, 2))
    }

    const config = readConfig(args.config)
    const profile = args.profile ?? config.profile ?? 'kimi'
    const preset = args.preset ?? config.preset ?? 'balanced'
    const models = config.models ?? null
    if (cmd === 'models') {
      const list = models ?? (Object.hasOwn(MODEL_PROFILES, profile) ? modelsFor(profile) : [])
      return writeExit(JSON.stringify(list, null, 2))
    }
    if (cmd === 'policy') {
      return writeExit([
        `路由策略 ${POLICY_VERSION}`,
        '1. 分别识别任务类型、复杂度、需求不明确程度和失败影响。',
        '2. 先检查模态、工具、上下文窗口与估算预算。',
        '3. HOLD 优先可用的适当档位，输出实际改动与备选限制。',
        '4. --shadow 记录影子建议；--record 生成可用于反馈的 routeId。',
      ].join('\n'))
    }

    const context = args.context ? readJsonFile(args.context, '--context') : undefined
    const options = { profile, preset, models, context }
    if (cmd === 'hook') return await runHook(args, options)
    if (cmd !== 'decide') throw new TypeError('Use decide, models, policy, hook or feedback')
    let prompt = args._.join(' ')
    if (!prompt && !process.stdin.isTTY) prompt = (await readStdin()).trim()
    if (!prompt && !context?.goal && !context?.taskType) throw new TypeError('Provide a prompt or a structured goal')
    const r = maybeRecord(decide(prompt, options), args, 'cli')
    if (args.shadow) {
      if (r.recording.status === 'failed') throw new Error(r.recording.reason)
      return writeExit(`[shadow] 已记录 routeId=${r.routeId}`)
    }
    writeExit(args.json ? JSON.stringify(r, null, 2) : formatReport(r))
  } catch (error) {
    if (cmd === 'hook') return writeExit('{}')
    process.stderr.write(`[model-router] ${error.message}\n`, () => process.exit(1))
  }
}

function isMain() {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}
if (isMain()) await main()
