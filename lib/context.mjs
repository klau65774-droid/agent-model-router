export const TASK_TYPES = ['code', 'agentic', 'reasoning', 'writing', 'translate', 'analysis', 'extract', 'multimodal', 'chat', 'knowledge']
export const INPUT_TYPES = ['text', 'code', 'document', 'table', 'json', 'image', 'audio', 'video']
export const MODALITIES = ['video', 'audio', 'image']
export const IMPACT_LEVELS = ['low', 'medium', 'high']
const MAX_TOKENS = 1_000_000_000

export const CONTEXT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    goal: { type: 'string', minLength: 1, description: 'Task goal supplied separately from the prompt material' },
    taskType: { type: 'string', enum: TASK_TYPES },
    inputTypes: { type: 'array', uniqueItems: true, items: { type: 'string', enum: INPUT_TYPES } },
    requiredTools: {
      type: 'array', uniqueItems: true, maxItems: 32, items: { type: 'string', pattern: '^[a-zA-Z0-9_.:-]{1,80}$' },
    },
    inputTokens: { type: 'integer', minimum: 0, maximum: MAX_TOKENS },
    expectedOutputTokens: { type: 'integer', minimum: 0, maximum: MAX_TOKENS },
    failureImpact: { type: 'string', enum: IMPACT_LEVELS },
    budget: {
      type: 'object', additionalProperties: false, required: ['maxEstimatedUsd'],
      properties: { maxEstimatedUsd: { type: 'number', minimum: 0 } },
    },
  },
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stringList(value, accepts, max) {
  return Array.isArray(value) && value.length <= max && new Set(value).size === value.length && value.every(accepts)
}

export function normalizeContext(context = {}) {
  if (!isObject(context) || Object.keys(context).some(key => !Object.hasOwn(CONTEXT_SCHEMA.properties, key))) {
    throw new TypeError('Invalid context: expected an object with supported fields')
  }
  const { goal, taskType, inputTypes, requiredTools, failureImpact, budget } = context
  if (goal !== undefined && (typeof goal !== 'string' || !goal.trim())) throw new TypeError('context.goal must be a nonempty string')
  if (taskType !== undefined && !TASK_TYPES.includes(taskType)) throw new TypeError('Invalid context.taskType')
  if (failureImpact !== undefined && !IMPACT_LEVELS.includes(failureImpact)) throw new TypeError('Invalid context.failureImpact')
  if (inputTypes !== undefined && !stringList(inputTypes, value => INPUT_TYPES.includes(value), INPUT_TYPES.length)) {
    throw new TypeError('context.inputTypes must be a list of distinct supported input types')
  }
  if (requiredTools !== undefined && !stringList(requiredTools, value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value), 32)) {
    throw new TypeError('context.requiredTools must be a list of distinct tool IDs')
  }
  for (const key of ['inputTokens', 'expectedOutputTokens']) {
    const value = context[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > MAX_TOKENS)) {
      throw new TypeError(`context.${key} must be a nonnegative integer up to ${MAX_TOKENS}`)
    }
  }
  if (budget !== undefined && (!isObject(budget) || Object.keys(budget).length !== 1 ||
      !Object.hasOwn(budget, 'maxEstimatedUsd') || !Number.isFinite(budget.maxEstimatedUsd) || budget.maxEstimatedUsd < 0)) {
    throw new TypeError('context.budget requires a nonnegative maxEstimatedUsd')
  }
  return context
}
