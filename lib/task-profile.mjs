import { MODALITIES, normalizeContext } from './context.mjs'

const HEURISTIC = { kind: 'heuristic', calibration: 'uncalibrated' }

// Each rule describes an action or deliverable. Topic nouns alone are intentionally weak evidence.
const PROOF = /证明|严格推导|(?:^|\s)证\s*[:：]|\b(?:prove|give (?:a|the) proof|show rigorously|derive .{1,60} from first principles)\b/iu
const CODE_ACTION = /重构|重写.{0,12}(?:实现|脚本|程序|接口)|迁移.{0,20}(?:库|数据库|服务|系统)|(?:bug|diff|脚本|代码|接口|函数).{0,24}(?:修好|修复|打补丁|改对)|(?:修复|改好|补好|修改|更新|实现|审查|部署|编写|加上?|补).{0,24}(?:脚本|代码|补丁|程序|接口|函数|爬虫|解析器|实现|数据库|测试|权限校验|bug|python|api|diff)|\b(?:refactor|debug|implement)\b|\b(?:fix|patch|correct|add|review|update|write|deploy|migrate|audit|ship|test)\b[^.!?;:\n]{0,52}\b(?:code|pr|pull request|patch|script|function|parser|tests?|database|service|implementation|bug|endpoint|api|module|sql|authorization checks?)\b/iu
const WORKFLOW = /(?:执行|运行|自动化|搭建).{0,15}(?:工作流|流程|流水线|多步骤)|(?:联网|上网)(?:查询|检索|查找|搜索)|(?:调用|使用).{0,12}(?:工具|浏览器).{0,8}(?:执行|访问|查找)|\b(?:run|execute|automate|orchestrate|schedule)\b[^.;:\n]{0,50}\b(?:workflow|pipeline|jobs?|tools?)\b|\b(?:fetch|look up|search the web for)\s+(?:today|the current|the latest|[a-z]+\s+online)/iu
const RULES = [
  ['translate', 10, /翻译|译[成为到]|中译英|英译中|本地化成|\b(?:translate|render .{1,45} into (?:english|chinese|spanish|japanese|french))\b/iu],
  ['extract', 9, /抽取|提取|摘出|摘取|筛出|整理成表格|解析成|转成(?:表格|json|csv)|(?:只|仅)(?:输出|返回).{0,12}(?:编号|字段|序列号|id\b)|\b(?:extract|ocr|transcribe)\b|\b(?:pull|select|return|copy|list)\b[^.;:\n]{0,60}\b(?:ids?|numbers?|fields?|quantity|columns?|csv|json|first match)\b|\bparse\b[^.;:\n]{0,50}\b(?:into|fields?)\b/iu],
  ['writing', 8, /校对|(?:写|起草|拟|创作|生成|润色).{0,16}(?:文案|故事|一句|一篇|图注|说明|通知|道歉|讲稿|大纲|小结|感谢|邮件|标题|简介|稿子|公告|短文|帖子)|\bproofread\b|\b(?:draft|compose|author|write)\b[^.;:\n]{0,30}\b(?:captions?|notes?|release[- ]notes?|posts?|letters?|notices?|announcements?|story|paragraphs?|sentence|essay|email|copy|apology)\b/iu],
  ['agentic', 9, WORKFLOW],
  ['code', 8, CODE_ACTION],
  ['reasoning', 9, /证明|推导|论证|计算|求解|(?:^|\s)证\s*[:：]|\b(?:prove|derive|calculate|solve|give (?:a|the) proof|show rigorously)\b/iu],
  ['analysis', 8, /分析|总结|摘要|对比|对照|归纳|评估|审计|综述|解读|研判|\b(?:analy[sz]e|summari[sz]e|compare|assess|evaluate|audit|identify the (?:difference|cause)|synthesi[sz]e)\b/iu],
  ['chat', 9, /扮演|模拟面试|陪聊|陪练|跟我聊天|\b(?:role[- ]?play|play the role of|pretend (?:you(?:'re| are)|to be)|chat with me)\b/iu],
  ['knowledge', 7, /什么是|是什么意思|解释|讲解|怎么理解|如何理解|科普|\b(?:what (?:is|are|does)|explain|define|tell me what|how does|why does)\b/iu],
]
const MEDIA_NOUNS = {
  video: /视频|影片|录像|\b(?:videos?|clips?|footage)\b|\.(?:mp4|mov|webm)\b/iu,
  audio: /音频|录音|语音|\b(?:audio|recordings?|voice notes?)\b|\.(?:mp3|wav|m4a)\b/iu,
  image: /图片|图像|照片|截图|平面图|这张图|图表|铭牌|\b(?:images?|pictures?|photos?|screenshots?|scans?|diagrams?)\b|\.(?:png|jpe?g|webp|gif)\b|!\[/iu,
}
const MEDIA_ACTION = /(?:看|观察|查看|读|检查|辨别|识别|识读|读出|描述|扫描|听|提取|数一数|对比|分析|总结).{0,24}(?:图|照片|视频|影片|录音|音频|铭牌)|(?:从|在).{0,14}(?:图|照片|视频|录音|音频|铭牌).{0,16}(?:提取|识别|读出|找出|描述)|\b(?:inspect|view|look at|describe|watch|listen to|read|count|extract|identify|transcribe|compare|summari[sz]e|analy[sz]e)\b[^.!?;:\n]{0,70}\b(?:images?|pictures?|photos?|screenshots?|scans?|diagrams?|videos?|clips?|footage|audio|recordings?|voice notes?|attached)\b/iu
const VISUAL_QUESTION = /(?:图|照片|截图)(?:里|上|中).{0,8}(?:有|写|显示)|\bwhat (?:is|are) (?:in|written on|shown in)\b/iu

const SCOPE_SEPARATOR = /^\s*(?:-{3,}|={3,}|<{3,}|BEGIN (?:MATERIAL|SOURCE|TEXT))\s*$/iu
const MATERIAL_HEADER = /(?:^|\s)(?:source(?: text)?|material|original text|input text)\s*[:：]|(?:原文|材料|正文|输入文本)\s*[:：]/iu
const MATERIAL_ACTION = /翻译|译成|译为|提取|抽取|摘要|总结|对比|写一句|\b(?:translate|summari[sz]e|extract|parse|draft|compose)\b/iu
const CLAUSE_BREAK = /[,，。！？；;\n]|(?<=[.!?])\s+|而是|但是|不过|改为|只(?:需|要)(?=.)|仅需|\b(?:but|instead|rather than)\b/iu
const NEGATION = /不(?:需要|要求|必|用|要|做|执行|修复|修改|改代码|部署|翻译|审计|分析|提取|重构|写|读|看|听|调用|运行)|无需|无须|请勿|禁止|别(?=翻|译|修|写|看|读|听|执|部|改|分|用|抽|提|审)|\b(?:do not|don['’]t|not asking|no need to|no|skip|without|avoid|never|not required)\b/iu
const REPORTED_TEXT = /^(?:据?(?:材料|原文|日志|引用)(?:提到|显示|写着|说)|(?:the\s+)?(?:log|transcript|excerpt|source|material)\s+(?:says|reads|states|mentions|contains)\b)/iu
const TUTORIAL = /^(?:请\s*|please\s+)?(?:解释(?:如何|怎么|怎样)|教我(?:如何|怎么)|什么是|(?:explain|teach me)\s+how\s+to\b|what\s+(?:is|are)\b)/iu

function instructionText(text) {
  const kept = []
  let fence = null
  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length &&
          !line.slice(marker[0].length).trim()) fence = null
      continue
    }
    if (marker) {
      fence = marker[1]
      continue
    }
    if (SCOPE_SEPARATOR.test(line)) break
    if (/^\s*>/.test(line)) continue
    const visible = line
      .replace(/(`+)[^`]*\1/g, ' ')
      .replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"]*"|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu, ' ')
    const explicit = MATERIAL_HEADER.exec(visible)
    const colon = visible.search(/[:：]/u)
    if (explicit) {
      kept.push(visible.slice(0, explicit.index))
      break
    }
    if (colon >= 0 && MATERIAL_ACTION.test(visible.slice(0, colon))) {
      kept.push(visible.slice(0, colon))
      break
    }
    kept.push(visible)
  }
  return kept.join('\n').trim()
}

function positiveClauses(text) {
  return text.split(CLAUSE_BREAK).map(part => part.split(NEGATION, 1)[0].trim())
    .filter(part => part && !REPORTED_TEXT.test(part))
}

function asksAboutMedia(clause) {
  return VISUAL_QUESTION.test(clause) || (!TUTORIAL.test(clause) && MEDIA_ACTION.test(clause))
}

function detectModalities(clauses) {
  return MODALITIES.filter(modality => clauses.some(clause => {
    if (modality === 'image' && /\bocr\b|!\[/iu.test(clause)) return true
    if (modality === 'audio' && /\btranscribe\b|转录/iu.test(clause) && MEDIA_NOUNS.audio.test(clause)) return true
    if (/术语|概念|文件名|路径|链接|标题|\b(?:define|caption about|file ?names?|paths?|extensions?|urls?|titles?|video transcripts?)\b/iu.test(clause)) return false
    return MEDIA_NOUNS[modality].test(clause) && asksAboutMedia(clause)
  }))
}

function classify(clauses, modalities, context) {
  if (context.taskType) {
    return { taskType: {
      value: context.taskType, confidence: 1, confidenceKind: 'host_provided', calibration: 'uncalibrated',
      evidence: ['宿主提供任务类型'],
    }, taskTypeAlt: null, unclear: false }
  }
  const ranked = RULES.map(([value, weight, pattern]) => {
    let score = 0
    for (const [index, clause] of clauses.entries()) {
      const scope = TUTORIAL.test(clause) ? 'explain' : clause
      const match = scope.match(pattern)
      if (match) score = Math.max(score, weight + (index === 0 ? 2 : 0) + (match.index <= 5 ? 1 : 0))
    }
    return { value, score }
  })
  const specificOutput = ranked.some(item => item.score && ['translate', 'extract'].includes(item.value))
  if (!specificOutput && modalities.length && clauses.some(asksAboutMedia)) {
    ranked.push({ value: 'multimodal', score: 9 + (asksAboutMedia(clauses[0]) ? 2 : 0) })
  }
  ranked.sort((a, b) => b.score - a.score)
  const [top, second] = ranked
  const gap = top.score - second.score
  const confidence = !top.score ? 0.35 : !second.score ? 0.88 : Math.min(0.88, (58 + gap * 5) / 100)
  return {
    taskType: {
      value: top.score ? top.value : 'knowledge',
      confidence, confidenceKind: 'heuristic', calibration: 'uncalibrated',
      evidence: top.score ? [`指令匹配：${top.value}（规则分 ${top.score}）`] : ['未识别可执行目标，采用通用问答兜底'],
    },
    taskTypeAlt: second.score ? {
      value: second.value,
      confidence: 0.45, confidenceKind: 'heuristic', calibration: 'uncalibrated',
    } : null,
    unclear: !top.score || gap <= 1,
  }
}

function estimateTokens(text) {
  if (!text) return 0
  let cjk = 0, other = 0
  for (const ch of text) {
    if (/[一-鿿　-〿＀-￯]/u.test(ch)) cjk++
    else other++
  }
  return Math.round(cjk * 0.75 + other * 0.325 + text.split(/\s+/u).length * 0.2)
}

const BASE_COMPLEXITY = {
  code: 42, agentic: 52, reasoning: 28, writing: 18, translate: 14,
  analysis: 40, extract: 14, multimodal: 27, chat: 15, knowledge: 16,
}

function complexityOf(type, text, positive) {
  let value = BASE_COMPLEXITY[type]
  const evidence = [`按任务类型 ${type} 取基础复杂度`]
  if (type === 'reasoning' && PROOF.test(positive)) {
    value += 46
    evidence.push('要求证明或严格推导')
  } else if (type === 'reasoning' && /(?:条件|已知).{0,40}概率|\b(?:posterior|conditional probability|base rate|derive)\b/iu.test(positive)) {
    value += 14
    evidence.push('需要结合条件进行推导')
  }
  if (/\b(?:zero[- ]downtime|distributed|architecture|atomic(?:ity)?|cross[- ](?:service|file)|rollback plan)\b|零停机|分布式|跨服务|多文件|原子性|回滚/iu.test(positive)) {
    value += 25
    evidence.push('涉及系统级约束或跨组件工作')
  }
  const steps = positive.match(/然后|最后|第一步|第二步|接着|阶段|\b(?:then|finally|next|step \d+)\b/giu)?.length ?? 0
  if (steps) {
    value += Math.min(16, 6 * steps)
    evidence.push('包含顺序步骤')
  }
  const constraints = text.match(/必须|禁止|不能|只能|至少|最多|不超过|\b(?:must|at least|at most|exactly|no more than)\b/giu)?.length ?? 0
  if (constraints) {
    value += Math.min(15, 5 * constraints)
    evidence.push('包含显式执行约束')
  }
  return { value: Math.min(98, value), ...HEURISTIC, evidence }
}

function impactOf(type, positive, declared) {
  if (declared) return { value: declared, kind: 'host_provided', evidence: ['宿主声明失败影响'] }
  const changesProd = /\b(?:deploy|migrate|roll out|switch|delete|drop)\b[^.!?;]{0,65}\b(?:production|prod|live database)\b|(?:部署|迁移|清空|删除|切换|更新).{0,20}(?:生产|线上)|生产.{0,18}(?:迁移|部署|切换)/iu.test(positive)
  const sensitiveDecision = type === 'analysis' && /(?:诊断|处方|禁忌|用药风险|投资建议|法律意见|合规风险)|\b(?:medical advice|diagnos(?:e|is)|prescrib(?:e|ing)|contraindication|investment advice|compliance risk|legal opinion)\b/iu.test(positive)
  if (changesProd || sensitiveDecision) {
    return { value: 'high', ...HEURISTIC, evidence: [changesProd ? '涉及实际生产变更' : '要求评估高影响决策'] }
  }
  if (type === 'code' && /权限校验|访问控制|\b(?:authorization checks?|access control|security issues)\b/iu.test(positive)) {
    return { value: 'medium', ...HEURISTIC, evidence: ['涉及访问控制或权限校验'] }
  }
  return { value: 'low', ...HEURISTIC, evidence: ['指令中未识别高影响动作'] }
}

function effortFor(type, complexity, impact) {
  if (impact === 'high') return { value: 'max', confidence: 0.9, ...HEURISTIC, evidence: ['高失败影响'] }
  if (complexity >= 70) return { value: 'max', confidence: 0.85, ...HEURISTIC, evidence: ['复杂度达到高档阈值'] }
  if (complexity < 35) return { value: 'low', confidence: 0.8, ...HEURISTIC, evidence: ['低复杂度任务'] }
  return { value: 'high', confidence: 0.8, ...HEURISTIC, evidence: [`${type} 任务需要常规推理`] }
}

export function analyze(prompt, suppliedContext) {
  const context = normalizeContext(suppliedContext)
  const text = String(prompt ?? '').trim()
  const instruction = instructionText(context.goal ?? text)
  const clauses = positiveClauses(instruction)
  const positive = clauses.join('\n')
  const actions = clauses.filter(clause => !TUTORIAL.test(clause)).join('\n')
  const modalities = context.inputTypes === undefined
    ? detectModalities(clauses)
    : MODALITIES.filter(modality => context.inputTypes.includes(modality))
  const { taskType, taskTypeAlt, unclear } = classify(clauses, modalities, context)
  const complexity = complexityOf(taskType.value, instruction, actions)
  const failureImpact = impactOf(taskType.value, actions, context.failureImpact)
  const estTokensIn = context.inputTokens ?? estimateTokens(context.goal && context.goal !== text ? context.goal + '\n' + text : text)
  const cjk = text.match(/[一-鿿]/gu)?.length ?? 0
  const expectedOutputTokens = context.expectedOutputTokens ?? null
  const contextTokens = expectedOutputTokens === null ? Math.ceil(estTokensIn * 1.6) : estTokensIn + expectedOutputTokens
  const maxEstimatedUsd = context.budget?.maxEstimatedUsd ?? null
  const explicitlyLong = /全文|整篇|整个文档|整本|全量|所有文件|\b(?:entire|whole|full)\s+(?:file|document|book|corpus)\b/iu.test(positive)

  const reasons = []
  const missingFields = []
  if (unclear) {
    reasons.push(taskTypeAlt ? '多个目标接近，请明确首要交付物' : '缺少明确的任务动作或交付物')
    missingFields.push('context.goal or context.taskType')
  }
  if (explicitlyLong && context.inputTokens === undefined && estTokensIn < 200) {
    reasons.push('提到全量材料，当前只有任务说明的 token 估算')
    missingFields.push('context.inputTokens')
  }
  if (maxEstimatedUsd !== null && expectedOutputTokens === null) {
    reasons.push('计算任务预算需要预计输出 token')
    missingFields.push('context.expectedOutputTokens')
  }

  const holdReasons = []
  if (unclear) holdReasons.push(reasons[0])
  if (failureImpact.value === 'high') holdReasons.push('高失败影响')
  if (failureImpact.value === 'medium') holdReasons.push('中等失败影响')
  const initialEffort = effortFor(taskType.value, complexity.value, failureImpact.value)
  const effort = holdReasons.length && initialEffort.value === 'low'
    ? { ...initialEffort, value: 'high', beforeHold: 'low', evidence: [...initialEffort.evidence, '门控将思考建议由 low 调至 high'] }
    : { ...initialEffort, beforeHold: initialEffort.value }

  return {
    taskType, taskTypeAlt, complexity, effort,
    ambiguity: { value: unclear ? 'high' : reasons.length ? 'medium' : 'low', ...HEURISTIC, reasons, missingFields },
    failureImpact,
    estTokensIn,
    chineseRatio: text.length ? Math.round(cjk / text.length * 100) / 100 : 0,
    needsLongContext: contextTokens > 20000 || explicitlyLong,
    modality: modalities[0] ?? 'none',
    modalities,
    needsRealtime: /\b(?:latest|today|real[- ]time|current exchange rate|live data)\b|最新|实时|今天|本周/iu.test(positive),
    stakes: failureImpact.value,
    requirements: {
      modalities, tools: context.requiredTools ?? [], inputTokens: estTokensIn,
      inputTokensKind: context.inputTokens === undefined ? 'estimated' : 'host_provided',
      expectedOutputTokens, contextTokens, maxEstimatedUsd,
    },
    hold: holdReasons.length > 0,
    holdReasons,
  }
}
