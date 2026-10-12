# 实现交接

## 任务 1/5：来源抓取、活动发现与同轮复用

### 已完成
- `discover.sh` 保留 TSV 兼容输出，并新增 `--json` v1 报告：`status`、各来源状态、正常候选、`pendingDate`、`exceptions`、`gaps`；退出码为 complete=0、partial=1、failed/usage=2。
- `new --cached` 零网络。日期为 `null` 的有身份活动变为待核实线索；同批正常条目仍输出。Hub/官方索引生成独立 URL 线索，只有精确保留 URL 才自动视为已覆盖。
- 命名源下载在临时文件中做 JSON 最低形状、空白/挑战/solver 错误页检查后再原子替换；失败保留最后成功缓存。官方命名入口改为 `/news`，首页没有新闻条目不算完整覆盖。
- `fetch.sh url --meta` 在保持正文模式兼容的同时返回已验证缓存路径/元数据。`FETCH_RUN_ID` / `DISCOVER_RUN_ID` 消除同一运行内的重复 force/关键词搜索与连续失败；`run-daily.sh` 传入每运行唯一的 `POGO_RUN_ID`。`FETCH_METRICS_FILE` 是可选 JSONL 指标入口。
- Scout 规则、README 与恢复提示已改为消费 JSON partial 结果，明确下载成功、最低接受、最终 processed state 三者不同。

### 对外接口
- `scripts/discover.sh new --cached --json`：读取报告即使退出码为 1；仅 `.status == "complete" && .completeNoNew` 能称无新增。
- `scripts/discover.sh --json "keywords"`：每个 LeekDuck/Hub/官方/Fandom 来源单独报告完成度；全部搜索失败不会伪装成无候选。
- `scripts/fetch.sh verify --json --max-age 86400 <source...>`：无网络验证命名缓存。
- `scripts/fetch.sh url [--max-age N|--force] --meta URL`：下载/复用后只输出元数据和正文路径。

### 实测
- `bash scripts/test-daily-reuse.sh` — PASS（含 discovery fixture、fetch 缓存/错误页/同轮复用、`test-daily-candidates.js`）
- `bash scripts/test-run-daily.sh` — PASS（含 `POGO_RUN_ID` 传递 fixture）
- `scripts/preflight.sh` — PASS（仅现有的 5 条超长 chip 警告）。
- `scripts/validate.sh` — 本机 UTC 2026-10-12 下仅因 `HEAD` 已有的 `max-mondays-2026-07-13`（结束于 2026-07-13，90 天截止为 2026-07-14）失败；本任务未改活动数据，非本次回归。用临时固定截止日 2026-07-13 的 `date` fixture 复跑后其余全部门禁 PASS。

### 下一任务依赖
- 后续 Scout/Calendar 应读取本任务 JSON 的 `candidates`、`pendingDate`、`exceptions` 与 `gaps`，不得把 partial 当 quiet day。
- 详情解读完成后仍只能由 90 State + Validator 写 `state.details`；不要把 fetch 元数据当 processed 标记。

### 未在本任务验证
- 未对真实第三方站点发起日更、未发布、未改 cron/Caddy/VPS；真实源格式漂移仍应由运行时报告为 partial/failed 而非猜测内容。
