# 本地反馈与执行记录

## 记录一次路由

默认路由和 Hook 不写文件。CLI 的 `--record`、Hook 命令的 `--record` 或 MCP 的 `route_prompt({ record: true, … })` 会生成本次路由的 UUID。每次成功写入都有独立的 `routeId`，即使提示词相同也可分别反馈。纯路由的 `routeId` 为 `null`，固定输入和配置可以原样复现。

```bash
node router.mjs decide "把标题译成中文" --json --record
node router.mjs decide "把标题译成中文" --shadow
```

`--shadow` 记录策略建议。CLI 只输出记录编号，Hook 返回 `{}`。`--record` 的 JSON 输出用 `recording.status` 表示 `recorded` 或 `failed`。日志写入失败时普通路由仍可返回建议，`routeId` 为 `null`。CLI 的显式影子记录或提交反馈失败时返回非零退出码，MCP 工具调用返回错误。

默认路径是 `~/.agent-model-router/feedback.jsonl`。可通过环境变量 `AMR_FEEDBACK_LOG` 配置各入口。CLI 和 Hook 可用 `--log <path>` 覆盖环境变量。为同一条路由提交反馈时，使用相同的日志。旧版 `log.jsonl` 可能包含旧提示词片段，新版回放使用有版本的 `feedback.jsonl`。

## 提交反馈

将以下示例保存为 `feedback-request.json`，替换为真实的 `routeId`、执行结果和指标。也可将同一对象作为 MCP `record_feedback` 的工具参数，或从标准输入传入 CLI。

```json
{
  "routeId": "cd72ac87-c293-4c77-9d4e-3c56af02c9d8",
  "actualModel": "kimi-k2.6",
  "adopted": true,
  "outcome": {
    "status": "success",
    "criterion": {
      "description": "标题译文通过双语校验",
      "source": "validator"
    }
  },
  "metrics": {
    "retries": { "value": 0, "kind": "measured" },
    "inputTokens": { "value": 98, "kind": "estimated" },
    "outputTokens": { "value": 15, "kind": "measured" },
    "latencyMs": { "value": 410, "kind": "measured" },
    "costUsd": { "value": null, "kind": "missing" }
  }
}
```

```bash
node router.mjs feedback feedback-request.json
node eval/replay.mjs --check --feedback ~/.agent-model-router/feedback.jsonl
```

- `actualModel` 是实际执行使用的模型 ID。在记录执行结果或执行指标时必填。
- `outcome.status` 支持 `success`、`failure` 和 `unknown`。前两项必须包含成功判据和来源。`criterion.source` 支持 `test`、`validator`、`human_review` 和 `user_confirmation`。填写可复核的简短判据，或填写判据的内部编号。
- 每个指标均带来源。使用 `measured` 表示直接观察到的值，`estimated` 表示估算，`missing` 对应 `null`。省略的指标按缺失记录。token 数和重试次数为非负整数。延时用毫秒，费用用 USD。若实际执行发生重试，提交整次运行的耗时、用量和费用，并填写重试次数。
- 仅记录采纳偏好时，提交 `routeId` 和布尔值 `adopted` 即可。偏好单独汇总。用 `user_confirmation` 判定成功时，记录用户明确确认满足的判据。

## JSONL 契约

每条事件共用 `schemaVersion: 1`、UTC `timestamp`、`event`、`routeId` 和 `policyVersion`。记录仅写入下表中的字段。

| 事件 | 字段 |
| --- | --- |
| `route` | `mode` 为 `recommendation` 或 `shadow`，另有 `entrypoint`、`modelProfile`、`preset`、`taskType`、`classificationConfidence`、`complexity`、`ambiguity`、`failureImpact`、`hold`。有可用候选时，`recommendation` 保存模型标识、档位、建议思考强度及未校准综合分。 |
| `feedback` | `actualModel`、`adopted`、`outcome`、`metrics`。版本从当前日志中的关联路由记录取得。 |

存储采用字段白名单。原始提示词、宿主目标、材料和规则匹配文本不写入日志。反馈中的判据由调用方填写并保存在本地。

仓库忽略常用的本地配置、反馈请求和执行报告文件名。使用 `--log` 或 `--out` 指定其他文件名时，可以把它们放在仓库目录之外。

反馈会追加到已有路由。离线统计按同一 `routeId` 的最新完整执行记录计算一次，偏好可以单独追加或更新。记录重复提交时，仍只统计一次。日志读取时会跳过无效记录，并单独报告解析失败及未关联条数。这个版本面向本地、小规模日志，读取与关联按文件扫描。

实测汇总要求普通路由建议与实际使用模型一致。有带判据的成功或失败才进入成功率分母，成本和延时只统计实测值。可传入包含不同策略版本的同一 JSONL 日志。影子和纯偏好事件用于离线分析。启发式分数和任务执行概率均不会被日志自动更新。
