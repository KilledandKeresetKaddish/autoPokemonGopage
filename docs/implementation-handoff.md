# 实现交接

## 任务 2/5：有界 daily runner、客观记录、精简常驻提示

### 范围 / 接口
- 在现有沙箱工作区继续任务 1；宿主路径 `/srv/pi-workspaces/autoPokemonGopage/` 在本容器挂载为 `/workspace`，不是生产路径。没有触碰真实 cron/Caddy、VPS、鉴权、模型配置或启动付费日更。
- `AGENT_TIMEOUT_SECONDS=7200` 是保护上限而非目标耗时；测试可缩短。`AGENT_TERM_GRACE_SECONDS`、`AGENT_DRAIN_SECONDS`、`AGENT_KILL_WAIT_SECONDS` 控制有限等待。`daily-agent-run.py` 用独立会话/进程组监管一个 CLI，TERM→KILL 后检查 Linux `/proc` 中非僵尸成员；未能确认全停即不触碰树/快照/门禁。`-p` 无输出不触发 idle 终止。进程组身份写进每轮日志，崩溃后下轮提示并拒绝仍活跃或未知的 writer；SIGKILL/掉电不能运行 trap。
- 每轮唯一 `POGO_RUN_ID`，`logs/runs/<run-id>/` 存各自的事件、summary、可选 Pi JSON、工作清单；`logs/lastAttempt.json` 与 `logs/lastSuccess.json` 独立。门禁、snapshot、publish 结果来自命令退出码；fetch 名源/详情请求、命中、失败、重试及 discover 覆盖来自可选 JSONL，缺失或指标写坏均记 null；真实 token usage 未验证故 null。成功 commit 后不改 tracked state。已从 `data/state.json` 一次性移除旧 agent 自述 `validation`/`contentStatus`，不改变 `sources`/`details` 的 processed 基线；90 brief 禁止下次再写入，客观结果只在忽略的日志中。
- 任务 1 的 JSON partial、`FETCH_METRICS_FILE`、`POGO_RUN_ID` 接口继续使用；新增 `DISCOVER_METRICS_FILE`。`scripts/daily-worklist.js --base-ref <committed-head> [--discovery <this-run-report>] [--changed ID|--pending ID|--force ID|--monthly-url URL] [--now ISO]` 是可重复的只读提示（来源 hash/时间、ID/URL 理由、日期、gaps），非完成证明；恢复态仍读 committed baseline。八份入口文档各注入一次；完整 schemas/HTML 示例迁移至受校验的 `tasks/reference/daily-schemas.md`，按需读取。mock 同一 operator note 下重构前模拟注入 **92,019 B**、之后实际 mock prompt **75,775 B**（少 16,244 B，17.7%）；八文档本体 90,185→73,021 B。工作清单按需读，不计入固定注入。

### 实测 / 局限
- `bash scripts/test-run-daily.sh` — PASS：同日两轮、成功/非零、长时间静默、总超时、TERM/INT、抗 TERM 子进程、无法确认 writer、dirty/锁/HEAD/越界、快照保存/恢复失败、记录失败/lastSuccess、单 prompt/参数透传。
- `bash scripts/test-daily-reuse.sh` — PASS；固定时间的 worklist discovery fixture — PASS；`scripts/preflight.sh` — PASS（原有 5 条 chip 长度警告）。
- `scripts/validate.sh` — 真实沙箱日期 2026-10-12 因原有 `max-mondays-2026-07-13` 超过 90 天失败；用临时 `date` fixture 将仅此截止日固定为 2026-07-13 后其余门禁 PASS。未修改活动数据；该问题与任务 1 交接一致。
- 沙箱未安装真实 `pi` 可执行文件，故只能用 mock 验证 `--version`/`--help` 检查、参数与 JSONL 接口；不能声称生产 Pi 的实际 event/token 格式或生产部署成功。独立于进程组的恶意 detached writer 仍须人工确认（沿用 unacknowledged-background 保护）；工作清单不替代来源解释。

### 下一任务依赖
- 继续读取任务 1 的 `discover --json` 和精确 URL 元数据；Scout 在实际准备缓存/扫描后以本轮报告刷新共享 checklist，输入真实 changed/pending/force ID，不能把 `cachedHash` 当 processed。
- 如果新任务涉及提醒 UI、时区时间迁移、发布目录切换，必须另行实现；本轮没有触碰这些功能。真实生产上部署前应在目标机器核对 Pi CLI 帮助、调度和权限，不自动运行模型作测试。


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
