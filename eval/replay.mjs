import { writeFileSync } from 'node:fs'
import { POLICY_VERSION } from '../router.mjs'
import { feedbackLogPath, readFeedbackLog } from '../lib/feedback.mjs'
import { executionSummary, replay, summary } from './evaluate.mjs'
import { BASE_COMMIT } from './fixtures.mjs'

const UNKNOWN = '不可评估'

function usage() {
  return 'Usage: node eval/replay.mjs [--split tuning|holdout] [--feedback path] [--out path] [--check]'
}

function parseArgs(args) {
  const options = {}
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === '--check') {
      options.check = true
      continue
    }
    if (!['--split', '--feedback', '--out'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(usage())
    options[key.slice(2)] = args[++i]
  }
  if (options.split && !['tuning', 'holdout'].includes(options.split)) throw new Error(usage())
  if (options.check && options.split === 'tuning') throw new Error('--check must include the holdout split')
  return options
}

function rate(count, total) {
  return total ? `${count}/${total}（${(100 * count / total).toFixed(1)}%）` : UNKNOWN
}

function metricRow(name, label, stats) {
  return `| ${name} | ${label} | ${rate(stats.typeCorrect, stats.count)} | ${rate(stats.violation, stats.count)} | ${rate(stats.missed, stats.count)} | ${rate(stats.over, stats.comparable)} | ${rate(stats.under, stats.comparable)} |`
}

function cell(value) {
  return String(value).replace(/[<>&|]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '|': '&#124;' })[ch]).replace(/[\r\n]+/g, ' ')
}

function outcome(grade) {
  const flags = [grade.violation && '硬约束违规', grade.missed && '漏荐', grade.over && '过度', grade.under && '不足'].filter(Boolean)
  const model = grade.model ? `${grade.model} / ${grade.effort}` : '空推荐'
  return cell(`${grade.type} · ${model}${flags.length ? ' · ' + flags.join('、') : ''}`)
}

function hasError(result) {
  return !result.typeCorrect || result.violation || result.missed || result.over || result.under
}

function examples(results) {
  const improved = results.filter(item => hasError(item.old) && !hasError(item.current))
  const hardCases = improved.filter(item => item.old.violation)
  const classificationCases = improved.filter(item => !item.old.violation && !item.old.typeCorrect)
  const cases = [
    ...hardCases.filter(item => item.row.split === 'holdout'),
    ...hardCases.filter(item => item.row.split === 'tuning'),
    ...classificationCases.filter(item => item.row.split === 'holdout'),
    ...classificationCases.filter(item => item.row.split === 'tuning'),
  ]
  const groups = new Set()
  const distinct = cases.filter(({ row }) => {
    if (groups.has(row.group)) return false
    groups.add(row.group)
    return true
  })
  const remaining = results.filter(item => hasError(item.current))
    .sort((a, b) => Number(b.row.split === 'holdout') - Number(a.row.split === 'holdout'))
  return [...distinct.slice(0, 8), ...remaining.slice(0, 8)]
}

function executionRows(path) {
  const heading = [
    '## 执行结果', '',
    '| 策略版本 | 与推荐一致的执行 | 成功率 | 平均成本 USD（实测 n） | P50 / P95 ms（实测 n） |',
    '| --- | ---: | ---: | ---: | ---: |',
  ]
  if (!path) return [...heading, `| 未提供反馈日志 | 0 | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} |`]
  const log = readFeedbackLog(feedbackLogPath(path))
  if (log.missing) throw new Error('The requested feedback log does not exist')
  const report = executionSummary(log)
  const rows = report.policies.map(p => `| ${cell(p.version)} | ${p.executions} | ${rate(p.successCount, p.knownCount)} | ${p.costCount ? p.averageCostUsd.toFixed(6) + '（' + p.costCount + '）' : UNKNOWN} | ${p.latencyCount ? p.latencyP50 + ' / ' + p.latencyP95 + '（' + p.latencyCount + '）' : UNKNOWN} |`)
  if (!rows.length) rows.push(`| 无可归因执行 | 0 | ${UNKNOWN} | ${UNKNOWN} | ${UNKNOWN} |`)
  return [...heading, ...rows, '',
    `日志包含 ${log.routes.size} 条路由、${report.shadowRoutes} 条影子路由、${report.adoptionOnly} 条仅偏好记录、${report.unmatchedExecutions} 条实际模型与推荐不同的执行、${log.malformed} 条无效记录、${log.orphaned} 条未关联反馈。`,
  ]
}

function render({ results, regressions, checksum }, options) {
  const groups = new Set(results.map(({ row }) => row.group)).size
  const lines = [
    '# 离线路由评测', '',
    `旧策略来自提交 ${BASE_COMMIT}，新策略为 ${POLICY_VERSION}。本次包含 ${results.length} 条样例、${groups} 个语义组。固定样例与自定义测试模型目录的 SHA-256 为 ${checksum}。`,
    '', '样例由实现者合成编写，每条记录包含来源、主要交付物类别、可接受的档位和思考建议区间、标注依据，以及适用的硬约束。同一语义组内包含改写或意图对照，只分配到一个集合。调参集用于调整规则，保留集用于回归验收。',
    '', '本报告衡量固定标签上的规则行为。样例和策略由同一实现者编写，缺少独立标注和真实任务采样。真实任务效果需采集带成功判据的执行记录。',
    '', '## 策略对比', '',
    '| 样例集 | 策略 | 分类准确率 | 硬约束违规率 | 可行但无推荐 | 过度升级率 | 不足升级率 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ]
  for (const split of ['tuning', 'holdout']) {
    const subset = results.filter(({ row }) => row.split === split)
    if (!subset.length) continue
    lines.push(metricRow(split, '旧', summary(subset, 'old')), metricRow(split, '新', summary(subset, 'current')))
  }
  lines.push('', '分类准确率、硬约束违规率和漏荐率以样例总数为分母。给出违反任一标注硬约束的推荐即记为违规。目录确实无可行候选时，空推荐符合约束。过度和不足只在可行推荐上计算，任一档位或思考建议越界即计入对应方向，两个方向可同时计入。',
    '', '### 各类命中', '',
    '| 样例集 | 任务类型 | 旧策略分类命中 | 新策略分类命中 |', '| --- | --- | ---: | ---: |')
  for (const split of ['tuning', 'holdout']) {
    const subset = results.filter(({ row }) => row.split === split)
    for (const type of [...new Set(subset.map(({ row }) => row.label.type))].sort()) {
      const cases = subset.filter(({ row }) => row.label.type === type)
      lines.push(`| ${split} | ${type} | ${rate(summary(cases, 'old').typeCorrect, cases.length)} | ${rate(summary(cases, 'current').typeCorrect, cases.length)} |`)
    }
  }
  lines.push('', '### 典型误判', '',
    '| 样例 | 标注依据 | 旧策略 | 新策略 |', '| --- | --- | --- | --- |')
  for (const result of examples(results)) {
    lines.push(`| ${result.row.id} | ${cell(result.row.label.basis)} | ${outcome(result.old)} | ${outcome(result.current)} |`)
  }
  lines.push('', ...executionRows(options.feedback),
    '', '成功率使用已经标明成功或失败且有判据的反馈。成本、P50 和 P95 只使用实测值，分位数采用最近秩。每项指标单独标注样本量。影子推荐、模型不匹配的执行及单纯采纳反馈均排除于策略执行指标之外。不同版本的执行记录可能对应不同任务分布。',
    '', '## 回归验收', '')
  if (options.check) {
    lines.push(regressions.length ? `检查失败（${regressions.length} 项）。` : '检查通过。固定输入逐项重放一致，保留集无新增硬约束违规或漏荐，关键任务未出现新增分类或档位错误。')
    if (regressions.length) lines.push('', ...regressions.map(item => `- ${item}`))
  } else lines.push('运行 `node eval/replay.mjs --check` 执行固定输入和保留集验收。')
  lines.push('', '本次实测命令、环境和剩余边界见 [集成验证](integration-test.md)。')
  return lines.join('\n') + '\n'
}

try {
  const options = parseArgs(process.argv.slice(2))
  const evaluation = replay({ split: options.split, check: options.check })
  const markdown = render(evaluation, options)
  if (options.out) writeFileSync(options.out, markdown)
  else process.stdout.write(markdown)
  if (evaluation.regressions.length) process.exitCode = 1
} catch (error) {
  console.error(`[replay] ${error.message}`)
  process.exitCode = 1
}
