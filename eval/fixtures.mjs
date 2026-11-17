import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

export const BASE_COMMIT = '4d9cffe37d0efd4acf2d8e4c0bf857b5a8bab2a6'
export const BASE_SOURCE_SHA256 = 'b87618ed3e322002fde7ba55a702cbc83b9bf22e738ed510406595098e0f9bf1'

function fixtureModel(id, { tier = 'pro', tools = [], image = false, priceIn, contextK, speedTps }) {
  return {
    id, name: id, tier, tools, modalities: { image }, priceIn, priceOut: priceIn * 4, contextK, speedTps,
    caps: { reasoning: 9, coding: 9, chinese: 9, writing: 9, agentic: 9 },
    thinking: 'effort',
  }
}

const fixtureTools = [
  fixtureModel('fixture-text', { tier: 'lite', priceIn: 0.1, speedTps: 120, contextK: 128 }),
  fixtureModel('fixture-scans-a', { tools: ['filesystem'], image: true, priceIn: 0.8, speedTps: 70, contextK: 256 }),
  fixtureModel('fixture-scans-b', { tools: ['filesystem'], image: true, priceIn: 1, speedTps: 90, contextK: 512 }),
  fixtureModel('fixture-web', { tools: ['web'], priceIn: 0.6, speedTps: 80, contextK: 256 }),
  fixtureModel('fixture-premium', { tier: 'flagship', tools: ['filesystem', 'web'], image: true, priceIn: 5, speedTps: 70, contextK: 512 }),
]

export const TIERS = ['lite', 'pro', 'flagship']
export const EFFORTS = ['low', 'high', 'max']
const types = ['code', 'agentic', 'reasoning', 'writing', 'translate', 'analysis', 'extract', 'multimodal', 'chat', 'knowledge']

export function digest(text) {
  return createHash('sha256').update(text).digest('hex')
}

export function loadCases() {
  const cases = readFileSync(new URL('cases.jsonl', import.meta.url), 'utf8').trim().split(/\r?\n/).map(JSON.parse)
  const ids = new Set()
  const groups = new Map()
  for (const row of cases) {
    const { id, group, split, source, label, prompt } = row
    if (!id || ids.has(id) || !group || !['tuning', 'holdout'].includes(split) ||
        (groups.has(group) && groups.get(group) !== split)) {
      throw new Error(`Invalid ID or split grouping: ${id}`)
    }
    if (!['synthetic', 'human'].includes(source) || typeof prompt !== 'string' || !label?.basis ||
        !types.includes(label.type) || !validBand(label.acceptableTiers, TIERS) || !validBand(label.acceptableEfforts, EFFORTS)) {
      throw new Error(`Missing provenance or invalid label: ${id}`)
    }
    ids.add(id)
    groups.set(group, split)
  }
  if (cases.length < 80 || new Set(groups.values()).size !== 2) throw new Error('Need at least 80 cases and both splits')
  return { cases, checksum: digest(JSON.stringify({ cases, fixtureTools })) }
}

function validBand(band, scale) {
  if (!Array.isArray(band) || !band.length) return false
  const start = scale.indexOf(band[0])
  return start >= 0 && band.every((value, index) => scale[start + index] === value)
}

export function caseInput(row) {
  const { prompt, material, context, profile = 'kimi', preset = 'balanced' } = row
  return {
    prompt: material ? prompt + '\n' + (material.line + '\n').repeat(material.count) : prompt,
    options: { context, profile, preset, models: profile === 'fixture-tools' ? fixtureTools : null },
  }
}

export function prediction(report) {
  return {
    type: report.profile.taskType.value,
    model: report.recommendation?.model ?? null,
    tier: report.ranking[0]?.tier ?? null,
    effort: report.recommendation?.effort ?? null,
    hold: report.profile.hold,
  }
}
