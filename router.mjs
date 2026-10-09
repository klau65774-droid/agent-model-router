#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────
// agent-model-router · 提示词路由引擎（零依赖 Node >= 18）
// 架构致敬 TypeSafe Jev：typed questions → calibrated confidence
//   → policy mapping（不确定 → 上移一档；失败放行 fail-open）
// 用法：
//   node router.mjs decide "<提示词>" [--profile kimi|claude] [--preset quality|balanced|budget|speed] [--json]
//   echo "<提示词>" | node router.mjs decide            # 管道输入
//   node router.mjs hook                                # Claude Code UserPromptSubmit 钩子（stdin/stdout JSON）
//   node router.mjs models [--profile kimi|claude]      # 列出模型库
//   node router.mjs policy                              # 打印路由策略
// ─────────────────────────────────────────────────────────────────
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

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

const KW = {
  code: ['代码', '编程', '函数', '报错', 'bug', '调试', '重构', '脚本', '接口', 'api', '算法实现',
    'python', 'java', 'javascript', 'typescript', 'c++', 'rust', 'sql', '编译', '堆栈', '异常',
    'exception', 'error', 'code', 'function', 'debug', 'refactor', 'implement', 'commit', '单元测试', '正则', 'docker', '部署',
    'review', 'fix', 'patch', 'pull request', 'merge', 'code review', '漏洞', 'security'],
  agentic: ['智能体', 'agent', '工具调用', 'tool', '工作流', 'workflow', '自动化', '自动执行', '定时',
    '爬取', '监控', 'mcp', '插件', '多步骤任务', '自主', '浏览器操作', 'function calling', 'pipeline'],
  reasoning: ['证明', '推导', '数学', '方程', '概率', '逻辑', '推理', '谜题', '奥数', '定理',
    '博弈', '最优化', '论证', 'math', 'prove', 'logic', 'puzzle', '竞赛'],
  writing: ['写一篇', '文案', '作文', '文章', '公众号', '小红书', '演讲稿', '剧本', '小说', '诗',
    '广告语', '标题', '品牌', '故事', '散文', '软文', 'write', 'essay', 'copywriting', 'story', '创作'],
  translate: ['翻译', '译成', '译为', '中译英', '英译中', '日文', '韩文', 'translate', 'translation',
    '字幕', '本地化', '改写', 'paraphrase'],
  analysis: ['分析', '总结这篇', '研报', '财报', '论文', '文献', '文档', '报告', '趋势', '对比',
    '调研', '综述', '解读', 'pdf', 'analyze', 'analysis', 'summarize', 'report', '要点提取', '审计'],
  extract: ['抽取', '提取信息', '结构化', 'json', 'xml', '表单', '字段', '实体识别', '分类打标',
    '标注', '解析成', '转成表格', 'extract', 'parse', 'schema', '结构化输出', '关键信息'],
  multimodal: ['图片', '图像', '照片', '截图', '图表', '视频', '音频', '语音', '识别图中', '看图',
    'ocr', 'image', 'picture', 'video', 'audio', '这张图', '海报', '多模态'],
  chat: ['扮演', '角色', '人设', '客服', '聊天', '对话', '陪聊', '语气', '口吻', 'roleplay',
    'chatbot', '模拟面试', '陪练', '陪伴'],
  knowledge: ['什么是', '为什么', '怎么理解', '教我', '讲解', '科普', '入门', '学习', '概念', '原理',
    'what is', 'how to', 'explain', '考试', '备考', '知识点'],
}

const REALTIME_KW = ['最新', '实时', '今天', '昨天', '本周', '股价', '汇率', '新闻', '天气', '热搜', 'latest', 'today', 'news', 'current']
const HIGH_STAKES_KW = ['合同', '法律', '医疗', '诊断', '处方', '投资建议', '风控', '生产环境', '上线', '金融', '合规', '诉讼']
const MULTI_STEP_KW = ['首先', '然后', '接着', '最后', '第一步', '第二步', '步骤', '阶段', '并且', '同时要求', '另外']
const CONSTRAINT_KW = ['必须', '不能', '禁止', '约束', '限制', '至少', '最多', '不超过', '只允许', '要求']
const LOW_EFFORT_TASKS = ['translate', 'chat', 'extract', 'knowledge']

// ─── 特征提取 ────────────────────────────────────────────────────
function estimateTokens(text) {
  let zh = 0, other = 0
  for (const ch of text) {
    if (/[一-鿿　-〿＀-￯]/.test(ch)) zh++; else other++
  }
  return Math.round(zh * 0.75 + (other / 4) * 1.3 + text.split(/\s+/).length * 0.2)
}

function cjkRatio(text) {
  let zh = 0
  for (const ch of text) if (/[一-鿿]/.test(ch)) zh++
  return text.length ? zh / text.length : 0
}

function countHits(text, kws) {
  const lower = text.toLowerCase()
  const matched = []
  let hits = 0
  for (const k of kws) {
    if (lower.includes(k.toLowerCase())) {
      hits++
      if (matched.length < 5) matched.push(k)
    }
  }
  return { hits, matched }
}

function calibrate(topScore, secondScore, hits) {
  if (hits === 0) return 0.35
  const margin = secondScore > 0 ? (topScore - secondScore) / topScore : 1
  const strength = Math.min(1, hits / 4)
  return Math.round((0.45 + 0.35 * margin + 0.17 * strength) * 100) / 100
}

function scoreTaskTypes(text) {
  const results = Object.keys(KW).map((type) => {
    const { hits, matched } = countHits(text, KW[type])
    let score = 0
    for (const m of matched) score += m.length >= 4 ? 2 : 1
    return { type, score, hits, matched }
  })
  if (/```/.test(text)) results.find((r) => r.type === 'code').score += 3
  if (/\{\s*"/.test(text)) results.find((r) => r.type === 'extract').score += 2
  if (/[一-鿿]/.test(text) && /(译|翻译)/.test(text)) results.find((r) => r.type === 'translate').score += 3
  return results.sort((a, b) => b.score - a.score)
}

function scoreComplexity(text, estTokens) {
  let score = 12
  const ev = []
  if (estTokens > 3000) { score += 30; ev.push(`输入约 ${estTokens} tok，信息量大`) }
  else if (estTokens > 800) { score += 20; ev.push(`输入约 ${estTokens} tok，中等篇幅`) }
  else if (estTokens > 200) { score += 10 } else ev.push('输入简短')
  const steps = countHits(text, MULTI_STEP_KW).hits
  if (steps >= 3) { score += 20; ev.push(`${steps} 处多步骤标记`) } else if (steps >= 1) { score += 10; ev.push('含步骤化描述') }
  const constraints = countHits(text, CONSTRAINT_KW).hits
  if (constraints >= 3) { score += 18; ev.push(`${constraints} 条显式约束`) } else if (constraints >= 1) score += 8
  if (/```/.test(text)) { score += 12; ev.push('含代码块') }
  if (/\d+%|\d+\.\d+|公式|方程/.test(text)) { score += 8; ev.push('含数值/公式') }
  if (countHits(text, ['随便', '看着办', '大概', '都可以', '无所谓']).hits > 0) { score -= 10; ev.push('需求表述较模糊') }
  return { value: Math.max(5, Math.min(98, score)), evidence: ev }
}

// ─── 思考强度推荐（Kimi 官方指引映射） ───────────────────────────
function recommendEffort(taskType, complexity, stakes) {
  if (stakes === 'high') return { value: 'max', confidence: 0.92, evidence: ['高利害场景，推理强度拉满'] }
  if (complexity >= 70) return { value: 'max', confidence: 0.9, evidence: [`复杂度 ${complexity}/100 ≥ 70`] }
  if (taskType === 'reasoning' && complexity >= 50) return { value: 'max', confidence: 0.88, evidence: ['推理类任务且复杂度中高'] }
  if (complexity < 35 && LOW_EFFORT_TASKS.includes(taskType))
    return { value: 'low', confidence: 0.85, evidence: [`复杂度 ${complexity}/100 较低的机械型任务`] }
  return { value: 'high', confidence: 0.85, evidence: [`复杂度 ${complexity}/100，日常开发/分析区间`] }
}

// ─── 画像分析（typed questions + confidence） ────────────────────
export function analyze(prompt) {
  const text = String(prompt || '').trim()
  const estTokens = estimateTokens(text)
  const ranked = scoreTaskTypes(text)
  const top = ranked[0], second = ranked[1]
  const taskType = top.score > 0 ? top.type : 'knowledge'
  const typeConf = top.score > 0 ? calibrate(top.score, second.score, top.hits) : 0.35
  const cx = scoreComplexity(text, estTokens)
  const needsLong = estTokens > 20000 || /整篇|全文|整个文档|整本书|所有文件/.test(text)
  let modality = 'none'
  if (countHits(text, ['视频', 'video', '影片']).hits > 0) modality = 'video'
  else if (countHits(text, ['音频', '语音', '录音', 'audio']).hits > 0) modality = 'audio'
  else if (countHits(text, KW.multimodal).hits > 0 || /!\[|\.(png|jpg|jpeg|webp|gif)/i.test(text)) modality = 'image'
  const needsRealtime = countHits(text, REALTIME_KW).hits > 0
  const stakes = countHits(text, HIGH_STAKES_KW).hits > 0 ? 'high' : cx.value >= 60 ? 'medium' : 'low'
  let effort = recommendEffort(taskType, cx.value, stakes)
  // 证明 / 严格推导类推理题直接 max（官方指引：数学证明留给 max 档）
  if (taskType === 'reasoning' && effort.value !== 'max' && /证明|prove|严格|定理|推导|证法/.test(text)) {
    effort = { value: 'max', confidence: 0.86, evidence: ['推理证明类任务，按官方指引用 max 档'] }
  }

  const holdReasons = []
  if (typeConf < 0.6) holdReasons.push(`任务类型置信度 ${(typeConf * 100).toFixed(0)}% < 60%`)
  if (top.score > 0 && second.score > 0 && top.score - second.score <= 1) holdReasons.push(`前两类任务得分接近（${top.type}/${second.type}）`)
  if (stakes === 'high') holdReasons.push('高利害场景')
  if (text.length < 12) holdReasons.push('提示词过短')
  const hold = holdReasons.length > 0
  if (hold && effort.value === 'low') {
    effort = { value: 'high', confidence: Math.max(0.7, effort.confidence - 0.1), evidence: [...effort.evidence, '门控触发：low → high'] }
  }

  return {
    taskType: { value: taskType, confidence: typeConf, evidence: top.matched.length ? [`命中：${top.matched.join('、')}`] : ['未命中关键词'] },
    taskTypeAlt: second.score > 0 ? { value: second.type, confidence: calibrate(second.score, top.score, second.hits) } : null,
    complexity: { value: cx.value, evidence: cx.evidence },
    estTokensIn: estTokens,
    chineseRatio: Math.round(cjkRatio(text) * 100) / 100,
    needsLongContext: needsLong,
    modality,
    needsRealtime,
    stakes,
    effort,
    hold,
    holdReasons,
  }
}

// ─── 模型匹配 ────────────────────────────────────────────────────
const PRESET_WEIGHTS = {
  quality: { q: 0.7, c: 0.2, s: 0.1 },
  balanced: { q: 0.5, c: 0.3, s: 0.2 },
  budget: { q: 0.3, c: 0.55, s: 0.15 },
  speed: { q: 0.35, c: 0.15, s: 0.5 },
}

export function apiParamsFor(model, effort) {
  if (model.thinking === 'effort') return { reasoning_effort: effort }
  if (model.thinking === 'binary')
    return effort === 'low' ? { thinking: { type: 'disabled' } } : { thinking: { type: 'enabled', keep: 'all' } }
  return {} // always：始终思考，无需传参
}

export function rank(profile, models, preset = 'balanced') {
  const need = TASK_NEED_WEIGHTS[profile.taskType.value] ?? TASK_NEED_WEIGHTS.knowledge
  const wBase = PRESET_WEIGHTS[preset] ?? PRESET_WEIGHTS.balanced
  // max 档任务（证明/复杂重构/高利害）质量权重抬到 0.7，不被省钱/速度稀释
  const w = profile.effort.value === 'max' && wBase.q < 0.7 ? PRESET_WEIGHTS.quality : wBase
  const complexityBoost = profile.complexity.value / 100
  const filteredOut = []
  const candidates = []
  for (const m of models) {
    if (profile.modality !== 'none' && !m.modalities[profile.modality]) {
      filteredOut.push({ id: m.id, why: `不支持${profile.modality}输入` }); continue
    }
    const needCtxK = Math.ceil((profile.estTokensIn * 1.6) / 1000)
    if (profile.needsLongContext && m.contextK < needCtxK) {
      filteredOut.push({ id: m.id, why: `上下文 ${m.contextK}K < 所需 ${needCtxK}K` }); continue
    }
    candidates.push(m)
  }
  const maxPrice = Math.max(...candidates.map((m) => m.priceOut), 1)
  const maxTps = Math.max(...candidates.map((m) => m.speedTps), 1)

  const results = candidates.map((m) => {
    let q = 0
    const contributions = []
    for (const [dim, weight] of Object.entries(need)) {
      if (weight <= 0) continue
      q += weight * m.caps[dim]
      contributions.push({ dim, v: weight * m.caps[dim] })
    }
    if (m.tier === 'flagship') q += complexityBoost * 0.4
    if (m.tier === 'lite') q -= complexityBoost * 0.5
    if (profile.chineseRatio > 0.5) q += (m.caps.chinese - 8.5) * 0.06
    const quality = Math.max(0, Math.min(10, q)) * 10
    const blended = m.priceIn * 0.75 + m.priceOut * 0.25
    const costScore = Math.max(2, 100 - (Math.log10(blended + 0.05) + 1.3) / (Math.log10(maxPrice + 0.05) + 1.3) * 100)
    const speedScore = (m.speedTps / maxTps) * 100
    let total = w.q * quality + w.c * costScore + w.s * speedScore
    if (profile.hold && m.tier === 'lite') total -= 18
    if (profile.hold && m.tier === 'flagship') total += 6
    if (m.thinking === 'always' && profile.effort.value === 'low') total -= 4
    // 高速变体：同模型 2 倍价格，仅速度优先时划算
    const highspeedPenalty = /highspeed/i.test(m.id) && preset !== 'speed'
    if (highspeedPenalty) total -= 5

    contributions.sort((a, b) => b.v - a.v)
    const reasons = contributions.slice(0, 2).filter((c) => c.v > 0.5)
      .map((c) => `${c.dim} ${m.caps[c.dim].toFixed(1)}`)
    if (m.thinking === 'effort') reasons.push(`可按推荐档 reasoning_effort=${profile.effort.value}`)
    if (m.thinking === 'binary' && profile.effort.value === 'low') reasons.push('思考可关，简单任务最省')
    const risks = []
    if (m.thinking === 'always' && profile.effort.value === 'low') risks.push('始终思考，简单任务也付推理 token')
    if (highspeedPenalty) risks.push('速度溢价 2×：仅「速度优先」或长输出场景划算')
    if (m.speedTps < 45) risks.push('输出偏慢')
    if (profile.stakes === 'high' && m.tier !== 'flagship') risks.push('高利害建议旗舰复核')

    return {
      id: m.id, name: m.name, tier: m.tier,
      total: Math.round(total * 10) / 10,
      quality: Math.round(quality), costScore: Math.round(costScore), speedScore: Math.round(speedScore),
      thinking: m.thinking,
      apiParams: apiParamsFor(m, profile.effort.value),
      reasons, risks, note: m.note,
    }
  })
  return { ranking: results.sort((a, b) => b.total - a.total), filteredOut }
}

export function decide(prompt, { profile = 'kimi', preset = 'balanced', models = null } = {}) {
  const p = analyze(prompt)
  const modelList = models ?? MODEL_PROFILES[profile] ?? MODEL_PROFILES.kimi
  const { ranking, filteredOut } = rank(p, modelList, preset)
  const top = ranking[0] ?? null
  return {
    profile: p,
    preset,
    modelProfile: profile,
    recommendation: top
      ? {
          model: top.id,
          modelName: top.name,
          score: top.total,
          effort: p.effort.value,
          apiParams: top.apiParams,
          thinkingNote:
            top.thinking === 'always' ? '该模型始终思考，档位不可调' :
            top.thinking === 'binary' ? '思考为开关式，按 apiParams 设置' :
            '三档可调，同会话固定档位保前缀缓存',
        }
      : null,
    ranking,
    filteredOut,
    policy: {
      hold: p.hold,
      holdReasons: p.holdReasons,
      rule: '置信度门控：不确定 → 推荐上移一档（fail-open：本工具任何异常都不应阻断主流程）',
    },
  }
}

// ─── 人类可读输出 ────────────────────────────────────────────────
function formatReport(r) {
  const p = r.profile
  const lines = []
  lines.push(`任务画像：${p.taskType.value}（置信度 ${(p.taskType.confidence * 100).toFixed(0)}%）` +
    (p.taskTypeAlt ? `，备选 ${p.taskTypeAlt.value}` : ''))
  lines.push(`复杂度：${p.complexity.value}/100 ｜ 输入 ≈${p.estTokensIn} tok ｜ 利害：${p.stakes} ｜ 模态：${p.modality}`)
  lines.push(`推荐思考强度：${p.effort.value.toUpperCase()}（${p.effort.evidence.join('；')}）`)
  if (p.hold) lines.push(`⚠ 置信度门控触发：${p.holdReasons.join('；')} → 推荐已上移一档`)
  lines.push('')
  if (r.recommendation) {
    const rec = r.recommendation
    lines.push(`★ 首选：${rec.modelName}（综合分 ${rec.score}）`)
    lines.push(`  调用参数：${JSON.stringify(rec.apiParams)}  ${rec.thinkingNote}`)
    lines.push('')
    lines.push('候选排行：')
    for (const [i, m] of r.ranking.entries()) {
      lines.push(`  ${i + 1}. ${m.name}  总分 ${m.total}（契合 ${m.quality} / 省钱 ${m.costScore} / 速度 ${m.speedScore}）`)
      if (m.reasons.length) lines.push(`     ✓ ${m.reasons.join('；')}`)
      if (m.risks.length) lines.push(`     ! ${m.risks.join('；')}`)
    }
  } else {
    lines.push('! 所有候选均被硬过滤排除')
  }
  if (r.filteredOut.length) lines.push(`已过滤：${r.filteredOut.map((f) => `${f.id}（${f.why}）`).join('、')}`)
  return lines.join('\n')
}

// ─── 影子日志（校准用） ──────────────────────────────────────────
function shadowLog(entry) {
  try {
    const dir = join(homedir(), '.agent-model-router')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'log.jsonl'), JSON.stringify({ ts: Date.now(), ...entry }) + '\n')
  } catch { /* fail-open */ }
}

// ─── CLI ─────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      if (['json', 'shadow'].includes(key)) args[key] = true
      else args[key] = argv[++i]
    } else args._.push(a)
  }
  return args
}

async function readStdin() {
  const chunks = []
  for await (const c of process.stdin) chunks.push(c)
  return Buffer.concat(chunks).toString('utf8')
}

function loadConfig(args) {
  if (!args.config) return {}
  try {
    return JSON.parse(readFileSync(args.config, 'utf8'))
  } catch {
    return {}
  }
}

// 写完 stdout 再显式退出：某些运行时（Electron as Node / Windows 管道）
// 在 stdin 未关闭时事件循环不会自然排空
function writeExit(str, code = 0) {
  process.stdout.write(str.endsWith('\n') || str === '' ? str : str + '\n', () => process.exit(code))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0] ?? 'decide'
  const cfg = loadConfig(args)
  const profileName = args.profile ?? cfg.profile ?? 'kimi'
  const preset = args.preset ?? cfg.preset ?? 'balanced'
  const models = cfg.models ?? null

  if (cmd === 'models') {
    writeExit(JSON.stringify(models ?? MODEL_PROFILES[profileName] ?? [], null, 2))
    return
  }
  if (cmd === 'policy') {
    writeExit([
      '路由策略（仿 Jev）：',
      '  1. 每条提示词回答类型化问题：任务类型(Choice) / 复杂度(Score) / 模态·长上下文·利害(Noul)',
      '  2. 置信度 < 0.6 或前两类接近 → HOLD：推荐上移一档，思考强度 low→high',
      '  3. 失败放行（fail-open）：本工具异常绝不阻断 Agent 主流程',
      '  4. 影子模式（--shadow）：只记录不输出建议，日志用于校准门限',
      '  5. 思考档位同会话固定，切档破坏前缀缓存',
    ].join('\n'))
    return
  }

  if (cmd === 'hook') {
    // Claude Code UserPromptSubmit 钩子：stdin 收 {"prompt": "..."}，stdout 回 additionalContext
    let input = ''
    try { input = await readStdin() } catch { /* fail-open */ }
    try {
      const payload = JSON.parse(input || '{}')
      const prompt = payload.prompt ?? payload.message ?? ''
      if (!prompt || String(prompt).trim().length < 8) {
        writeExit('{}')
        return
      }
      const r = decide(prompt, { profile: profileName, preset, models })
      shadowLog({ mode: 'hook', prompt: String(prompt).slice(0, 500), recommendation: r.recommendation?.model, hold: r.profile.hold })
      if (args.shadow) { writeExit('{}'); return }
      const rec = r.recommendation
      if (!rec) { writeExit('{}'); return }
      const ctx =
        `[model-router] 任务=${r.profile.taskType.value}(${(r.profile.taskType.confidence * 100).toFixed(0)}%) ` +
        `复杂度=${r.profile.complexity.value}/100 → 推荐模型 ${rec.modelName}` +
        (r.profile.effort ? `，思考强度 ${r.profile.effort.value.toUpperCase()}` : '') +
        `（调用参数 ${JSON.stringify(rec.apiParams)}）` +
        (r.profile.hold ? `。门控触发：${r.profile.holdReasons.join('；')}，已上移一档` : '') +
        '。若当前模型/档位与推荐不符，请告知用户或按既定机制切换；此建议仅供参考，不阻断任务。'
      writeExit(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: ctx },
      }))
    } catch {
      writeExit('{}') // fail-open
    }
    return
  }

  // decide
  let prompt = args._.slice(1).join(' ')
  if (!prompt && !process.stdin.isTTY) prompt = (await readStdin()).trim()
  if (!prompt) {
    console.error('用法: node router.mjs decide "<提示词>" [--profile kimi|claude] [--preset balanced] [--json] [--shadow]')
    process.exit(1)
  }
  const r = decide(prompt, { profile: profileName, preset, models })
  if (args.shadow) {
    shadowLog({ mode: 'shadow', prompt: prompt.slice(0, 500), recommendation: r.recommendation?.model, effort: r.profile.effort.value, hold: r.profile.hold })
    writeExit(`[shadow] 已记录到 ~/.agent-model-router/log.jsonl（不输出建议）`)
    return
  }
  writeExit(args.json ? JSON.stringify(r, null, 2) : formatReport(r))
}

// 仅作为脚本直接执行时才运行 CLI；被 mcp-server import 时只导出函数
import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) main().catch(() => process.exit(0)) // fail-open：任何异常静默退出
