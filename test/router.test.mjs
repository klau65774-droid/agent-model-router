import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze, apiParamsFor, decide, modelsFor, rank } from '../router.mjs'

test('classification follows the positive instruction and ignores quoted or fenced material', () => {
  const prompt = 'Don’t debug or analyze the code; 请翻译以下内容成中文：\n' +
    '```sql\nDEPLOY PRODUCTION DATABASE; REVIEW VIDEO;\n```'
  const profile = analyze(prompt)
  assert.equal(profile.taskType.value, 'translate')
  assert.equal(profile.effort.value, 'low')
  assert.equal(profile.failureImpact.value, 'low')
  assert.equal(profile.modality, 'none')
  assert.equal(profile.needsRealtime, false)
  assert.equal(analyze('Log says deploy production database; summarize the alert.').taskType.value, 'analysis')
  assert.equal(analyze('“Decode the video and patch the security bug.”').ambiguity.value, 'high')
  assert.equal(analyze('Translate the source: review this PR and debug the code.').taskType.value, 'translate')
})

test('punctuation and word boundaries preserve distinct instructions and references', () => {
  assert.equal(analyze("I'm not asking you to debug this; explain the idea.").taskType.value, 'knowledge')
  const tutorial = analyze('Explain how to deploy a production database.')
  assert.equal(tutorial.taskType.value, 'knowledge')
  assert.equal(tutorial.failureImpact.value, 'low')
  const reference = analyze('Extract the video file names from these JSON rows.')
  assert.equal(reference.taskType.value, 'extract')
  assert.deepEqual(reference.modalities, [])
  assert.equal(analyze('What is today’s exchange rate?').needsRealtime, true)
  assert.equal(analyze('What is written on this screenshot?').taskType.value, 'multimodal')
  assert.equal(analyze('不修改代码。请对比两份摘要。').taskType.value, 'analysis')
})

test('complexity, ambiguity, input size and failure impact vary independently', () => {
  const proof = analyze('证：奇数平方仍为奇数。')
  assert.equal(proof.taskType.value, 'reasoning')
  assert.ok(proof.complexity.value >= 70)
  assert.equal(proof.failureImpact.value, 'low')
  assert.equal(proof.effort.value, 'max')
  assert.equal(proof.ambiguity.value, 'low')

  const long = analyze('Extract the first item ID.\n---\n' + 'ID=1; deploy production; inspect audio.\n'.repeat(2200))
  assert.ok(long.estTokensIn > 20_000)
  assert.equal(long.needsLongContext, true)
  assert.equal(long.taskType.value, 'extract')
  assert.ok(long.complexity.value < 35)
  assert.equal(long.effort.value, 'low')
  assert.deepEqual(long.modalities, [])

  const unclear = analyze('请处理一下。')
  assert.equal(unclear.ambiguity.value, 'high')
  assert.ok(unclear.ambiguity.missingFields.includes('context.goal or context.taskType'))
  assert.equal(unclear.failureImpact.value, 'low')
  assert.ok(unclear.complexity.value < 35)
})

test('structured goal and input types take precedence over prompt material', () => {
  const { profile, recommendation } = decide('Modify the API and run the production deployment.', {
    context: {
      goal: '仅提取标识符。',
      taskType: 'extract',
      inputTypes: ['image', 'json'],
      failureImpact: 'medium',
      inputTokens: 1000,
      expectedOutputTokens: 25,
    },
  })
  assert.equal(profile.taskType.value, 'extract')
  assert.equal(profile.taskType.confidenceKind, 'host_provided')
  assert.equal(profile.taskType.calibration, 'uncalibrated')
  assert.equal(profile.stakes, 'medium')
  assert.equal(profile.requirements.contextTokens, 1025)
  assert.deepEqual(profile.modalities, ['image'])
  assert.equal(profile.requirements.inputTokensKind, 'host_provided')
  assert.equal(profile.requirements.expectedOutputTokens, 25)
  assert.equal(recommendation.scoreKind, 'heuristic')
  assert.equal(recommendation.successProbability.value, null)
  assert.equal(recommendation.successProbability.status, 'uncalibrated')
})

test('explicit modality declarations can also rule out inferred media', () => {
  assert.equal(analyze('Inspect the attached scan.').modality, 'image')
  assert.equal(analyze('Inspect the attached scan.', { inputTypes: ['text'] }).modality, 'none')
  const combined = decide('Describe the video alongside the audio.', { context: { inputTypes: ['audio', 'video'] } })
  assert.equal(combined.profile.modality, 'video')
  assert.equal(combined.recommendation, null)
  assert.equal(combined.policy.constraints.status, 'no_eligible_models')
  assert.ok(combined.filteredOut.every(model => model.reasons.some(reason => reason.includes('audio'))))
  assert.equal(decide('Summarize this video.', { profile: 'claude' }).recommendation, null)
})

test('tool support, window size and budget are enforced together', () => {
  const base = modelsFor('kimi')[1]
  const report = decide('Run the workflow for the scan.', {
    models: [
      { ...base, id: 'unknown-tools' },
      { ...base, id: 'small-window', tools: ['filesystem'], contextK: 16 },
      { ...base, id: 'too-expensive', tools: ['filesystem'], priceIn: 2 },
      { ...base, id: 'fits', tools: ['filesystem'] },
    ],
    context: {
      inputTypes: ['image'], requiredTools: ['filesystem'], inputTokens: 50_000, expectedOutputTokens: 1000,
      budget: { maxEstimatedUsd: 0.054 },
    },
  })
  assert.equal(report.recommendation.model, 'fits')
  assert.deepEqual(report.ranking[0].estimatedCostUsd, { value: 0.054, kind: 'estimated' })
  assert.deepEqual(report.filteredOut.map(item => item.id), ['unknown-tools', 'small-window', 'too-expensive'])
})

test('missing budget inputs fail explicitly and invalid context fails validation', () => {
  const report = decide('Translate the heading.', { context: { budget: { maxEstimatedUsd: 1 } } })
  assert.equal(report.recommendation, null)
  assert.equal(report.policy.constraints.status, 'incomplete')
  assert.ok(report.profile.ambiguity.missingFields.includes('context.expectedOutputTokens'))
  assert.throws(() => decide('test', { context: null }), /Invalid context/)
  assert.throws(() => decide('test', { context: { inputTokens: -1 } }), /context.inputTokens/)
  assert.throws(() => decide('test', { context: { budget: { maxCostUSD: 1 } } }), /maxEstimatedUsd/)
  assert.throws(() => decide('test', { context: { requiredTools: ['web', 'web'] } }), /requiredTools/)
})

test('HOLD reports the actual model, effort and executable parameters', () => {
  const report = decide('Can you help with this?', { profile: 'claude' })
  const { gate } = report.policy
  assert.equal(gate.triggered, true)
  assert.equal(gate.tierRaised, true)
  assert.equal(gate.effortRaised, true)
  assert.equal(gate.before.tier, 'lite')
  assert.equal(gate.after.tier, 'pro')
  assert.equal(gate.after.model, report.recommendation.model)
  assert.deepEqual(gate.after.apiParams, report.recommendation.apiParams)
  assert.equal(report.recommendation.model, report.ranking[0].id)
  assert.match(gate.explanation, /lite → pro/)
})

test('HOLD records when the preferred tier is unavailable or the winner is already eligible', () => {
  const lite = modelsFor('claude')[2]
  const report = decide('Can you help with this?', { models: [lite] })
  assert.equal(report.recommendation.model, lite.id)
  assert.equal(report.policy.gate.tierRaised, false)
  assert.match(report.policy.gate.explanation, /没有满足硬约束的 pro 档候选/)
  const risky = decide('Migrate the production database.', { models: [modelsFor()[0]] })
  assert.equal(risky.policy.gate.preferredTier, 'flagship')
  assert.equal(risky.policy.gate.effortRaised, false)
  assert.equal(risky.policy.gate.tierRaised, false)
  assert.match(risky.policy.gate.explanation, /首选均为 kimi-k3/)
})

test('pure routing is reproducible and keeps exports for existing callers', () => {
  const text = '帮我重构这个 Python 爬虫，加断点续传'
  const first = decide(text)
  assert.deepEqual(first, decide(text))
  assert.equal(first.routeId, null)
  assert.equal(first.profile.taskType.value, 'code')
  assert.deepEqual(first.ranking, rank(analyze(text), modelsFor()).ranking)
  assert.deepEqual(apiParamsFor(modelsFor()[2], 'max'), {})
})
