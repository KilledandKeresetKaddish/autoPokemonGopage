# 活动时间契约（事件源事实 ≠ 提醒推算）

`public/data/events.json` 每条保留原稳定 `id`、日历用 `start`/`end`，新增唯一权威的 `timing`；English overlay **不复制**这些事实。日历 `parseDay()` 继续取已有日期铺格，绝不可当作提醒零点。此处 `end` 是排他的活动结束瞬间：`now < openAt` 未开始，`openAt <= now < closeAt` 可提醒/完成，`now >= closeAt` 到期；canonical 活动的约 90 天历史留存与个人提醒到期删除互不相干。

```json
"timing": { "scope": "global", "mode": "local", "startPrecision": "exact", "endPrecision": "exact" }
```

| 字段 | 可选值 / 限制 |
|---|---|
| `scope` | `global` 全球可参与；`regional` 限定地区/城市；`unknown` 没有可靠覆盖证据。它与当地时间 **不是同一维度**；范围未知但绝对时刻已知仍可计算该时刻，不能据此声称活动是全球可参加。 |
| `mode` | `local` 来源定义墙钟时间；`absolute` 来源给唯一时刻（精确边界须带 `Z`/数值偏移）；`unknown` 不清楚时间机制。范围未知时仍可能已核实墙钟或绝对时刻；仅 `local + scope:unknown` 无法将墙钟换算为安全的提醒瞬间。 |
| `startPrecision` / `endPrecision` | `exact` 来源支持完整年月日时分秒（但缺少 scope/mode 时仍不能计算本地墙钟的唯一提醒瞬间）；`date` 仅核实日期；`unknown` 连边界的日期/性质也待核实。各端独立，可已知开始而未知结束。`end` 缺失时只能 `endPrecision:unknown`。 |
| `timeZone` | **仅** `regional+local`，且可确定单一举办地时必须填有效 IANA 时区（如 `America/Los_Angeles`），绝不用浏览器/服务器时区或固定当前偏移。多地点汇总无法确认同一活动窗口时保持 `mode:unknown`，不得任选一城。 |

`start`/`end` 可为 `YYYY-MM-DD`，或严格的 `YYYY-MM-DDTHH:mm:ss[.SSS][Z|±HH:mm]`（日期/时分秒必须合法，不自动进位）。`local + exact` 要无偏移墙钟；`absolute + exact` 要显式偏移。`date` 的旧 `00:00/23:59` 占位文本可保留以兼容日历，但程序只读日期，不生成任何提醒 instant；能定向确认只有日期时可将其改为纯日期。没有单一窗口的多场活动 `unknown` 也只展示，不推算。`start/end` 相同时不得宣称两端 `exact`（半开区间为空）；不同 offset 的精确 absolute 先比较 epoch，local 先严格验证墙钟，再比较活动当地顺序。

纯函数 `resolveEventTiming(event, now, viewerTimeZone)`（`public/app.js`，Node 与浏览器共用）返回 `openAt`、`closeAt`（Date 或 null）、`viewerWindow.start/end`（各自的 instant、本地日期/时间或 null）、`status` 和解释 `reason`。global+local 起点以 `Pacific/Kiritimati` UTC+14 转换；终点固定 UTC−12，**不可换成 UTC−11**。浏览器本地 *活动* 时段仍在查看者自己的 IANA 时区按相同墙钟转换，而提醒窗口是上述跨全球区间；两者分别输出。regional+local 两端在举办地当天 IANA 规则中换算，DST gap 按现有 `zonedWallTimeToInstant` 的前移约定、fold 取较早 instant；absolute 直接使用源偏移对应的 instant，不二次外扩。仅在浏览器无法解析本地 IANA 时使用现有明确 UTC fallback；Node 调用者应显式传入 viewerTimeZone/now。viewer 时区只改显示，不改确定的提醒开始/截止。无效数据返回 `status:error`，缺少精确开始/截止的部分结果保留 null，不能猜结束自动删除或猜开始自动通知。

迁移与来源：2026-10-12 的一次性审查将所有保留的活动显式分类；当前/将来优先从已读取的 LeekDuck、Hub、官网正文核实，证据保存在有界 `data/state.json.timingEvidence[eventId] = {url,basis}`（链接须能回到活动/公告，`basis` 仅一句话，不重复整页）。时间冲突先核对公告日期/修订；以最新明确官方说明为先，不能从两个相互矛盾的来源拼装新起止。历史不大规模重抓，分类 `unknown` 且保留旧日期/ID；各项剩余待核实 ID 和原因见 `docs/event-timing-review.md`。后续 Scout 在 `timing` 的范围/模式未知或任一端不是 `exact` 时将其作为 pending 详情候选，取最新正文再交 Calendar 定向补全，不因正文缓存新旧改变 processed hash 的提交顺序。日更新行必须带完整 timing，`scripts/check-event-timing.js` 同时接入 preflight/validate；其 `validateEventTiming(...,{allowLegacy:true})` **仅供旧消费方显式兼容**，两个发布门禁始终要求 timing，不能通过兼容选项放行新内容。
