# 实现交接

## PR #36 第二轮审查修复（2026-10-14 UTC）

- **基线/范围**：干净工作树，现有分支 `feat/daily-timing-personal-reminders` / PR #36 OPEN、base `main`，本地/远端/PR head 同为 `fdc3843`。保留原五个提交及首轮审查提交，只追加修复；首轮全 writer Web Locks、Hub partial、父 shell retry budget 未改。
- **先红后绿**：未修生产代码时，新增生产控件/action VM 回归分别复现完成/完成→starred、取消/取消→starred、撤销/撤销→completed、标星/标星→absent，以及重建 textarea 显示 `saved note` 而非 `unsaved new draft`。真实同 origin Chromium 按钮也复现完成/完成与取消/取消反转；隔离 `fdc3843` worktree 用同一浏览器测试复现失败草稿 E→F→E。修复后全部通过。每个最终写/删间隙只发起另一操作，外部释放屏障后再等待，不让持锁者 await 同锁 writer。
- **按钮意图**：详情/侧栏每次同步都登记明确操作方向与 token，点击时任何 await 前复制；refresh 后仅核对 token，不重新 toggle。同向完成/撤销/标星/取消幂等，旧命令不能作用于新 incarnation，锁等待跨截止不能恢复过期行。保留取消确认、同活动防重入、焦点、日历/侧栏派生极光同步；删除失败不先取消适用草稿。
- **草稿显示**：重建/同步优先显示同 token pending.note（failed / flight 均包括），新控件 blur 不重排旧文本或创建第二 flight；取消/到期/重标星才使旧 token 草稿失效。保留 IME、语言切换、500 Unicode 字符和纯文本安全渲染，旧回调不恢复失效草稿。
- **真实 UTC 留存**：10/14 cutoff `2026-07-16`，严格 `end` 日期小于 cutoff 才删。唯一删除 `raidhour20260715`（end `2026-07-15T19:00:00`），同步删除 English key 和当前待核实列表行；无 featured / AI dangling ID。剩余 179 行，其中 157 行需核实全部/部分时间、152 行 scope/mode unknown。未更改 meta/state、时段或其余内容，不伪造日更时间。
- **实际验收全部 exit 0**：`node scripts/test-event-reminders.js`（纳入 concurrency→新增 UI 回归，两者另独立执行）、`node scripts/test-event-timing.js`、`node scripts/test-spot-atlas-time.js`、`bash scripts/test-daily-reuse.sh`、`bash scripts/test-fetch-retries.sh`、`bash scripts/test-run-daily.sh`（仅隔离仓库/mock）、真实当天 preflight/validate（179 events，原有 5 long-chip WARN）。保护清单 38→39，无旧条目减少；app 缓存 v24→v25。JS/Bash 语法、diff whitespace 与全部保护哈希核对，无 runner PID/进程组/writerStopped 或门禁调整。
- **浏览器实际执行**：现有 `/usr/bin/chromium` + `/workspace/.pi-tmp/browser-tools/node_modules/playwright-core`，1440×1050 / 390×844，同 context/origin 的真实详情与侧栏按钮、Web Locks 外部屏障。四种同向操作、旧完成/取消命令与删除重标星、排队跨截止、failed/flight 中 E→F→E 的实际 textarea/blur、失败取消草稿、旧 token 草稿清理均 PASS；原多帧极光/IME/语言/存储/超时/holder-close/TODO/Atlas/Clock 仍通过，零 page errors。新 fixture 初版曾超时：不再把冻结时钟停在距截止 1ms（精确 ±1ms 留在纯 fixtures）；正常动画检查后仅多 page 逻辑阶段使用 reduced-motion，避免单 CPU 绘制饥饿。扩充套件有 180 秒硬上限，不修改产品锁超时。
- **未覆盖/交付边界**：已读取本轮桌面/手机截图；沙箱无 CJK 字体，不能证明全部中文字形可读。未测 Safari/Firefox、真实手机/系统 IME；未运行真实模型、生产 solver/日更、publish、VPS/Caddy/cron。旧开着的页面需刷新；异步 pagehide 保存仍不保证落盘。普通 push 原 PR，保留原正文追加本轮验收，不自动 resolve review、不合并、不部署。

## PR #36 审查修复（2026-10-13 UTC）

- 基线确认：宿主仓库挂载 `/workspace`，remote 为 `KilledandKeresetKaddish/autoPokemonGopage`；PR 仍 OPEN，head `37a4b73` / `feat/daily-timing-personal-reminders`，base `main`。工作树初始干净，无后续修复提交；保留任务 1–4 与集成的五个提交，仅追加本轮修复。
- **删除/笔记竞争**：先在生产 store 的最后 getItem→setItem 间隙注入另一标签 remove，旧实现双方成功却留下旧 token/笔记。改用同源 Web Locks 排他锁包住所有读取、token/时间判断、合并与写/删（含清理、canonical、迁移、重试）；无无锁回退。删除若后执行则最后清空，若先执行则旧 token 锁内重读失败，新 incarnation 也不被旧 autosave 覆盖。v1 格式/既有个人数据不变；部分 v0 迁移的对应行随删除清理。接口改为 Promise，UI/IME/失焦/关抽屉/语言/storage/scheduler 全部适配，等待/失败不报已保存，旧回调不挂回取消草稿。锁失败的显式 canonical 更新先重试再清理。
- **Hub 搜索覆盖**：四源 available 的指定空壳 fixture 旧为 complete-empty；现在没有可识别 article entries 的正文（包括无结构 `No results found.`）保守 partial，不伪造网络失败或可信零结果。正常候选保留；其他来源 stdout、schema/exit 0/1/2 和官网防护不变。TTL body 每次由新 parser 判断；同轮 report key 含 parser hash，旧 complete 缓存不能绕过。
- **共享 retry budget**：两个失败图片 URL 的 mock 旧为 4 次请求/2 retry，新为 3/1。图片 HEAD 与 FlareSolverr 都在父 shell 调 transport，临时文件再交 tr/grep/jq；保留 transport 错误、解析/空文件失败、cleanup、原子缓存与 last-good。等价 solver、多 URL、budget=0、恢复成功、预算耗尽后的首次请求、真实 fetch→daily-run-record summary 与零网络 cache hit 均有离线断言。
- **实际验收全部 exit 0**：`node scripts/test-event-reminders.js`（含 `test-reminder-concurrency.js`，另独立跑过）、`node scripts/test-event-timing.js`、`node scripts/test-spot-atlas-time.js`、`bash scripts/test-daily-reuse.sh`（含 `test-fetch-retries.sh`，另独立跑过）、`bash scripts/test-run-daily.sh`；修改 JS/Bash 语法、`git diff --check`、全部 **38** protected hashes。runner 环境 getpid 与 `/proc/self/stat` 一致，进程组/writerStopped 检查未改。
- **浏览器已执行**：`PLAYWRIGHT_MODULE=/workspace/.pi-tmp/browser-tools/node_modules/playwright-core node scripts/test-event-reminders-browser.js`，现有 `/usr/bin/chromium`；同一 context/origin 的真实多 page 与外部释放的锁屏障，让 note/remove 同时处于排队，不是顺序成功调用。验证最终删除、重标星、持锁标签关闭、真实 5 秒排队取消、能力缺失/拒绝、未保存输入恢复；原桌面/390px 极光、IME/语言/expiry/TODO/Atlas 等仍通过，零 page errors。截图/依赖/日志不提交。本次沙箱缺 CJK 字体（仅 DejaVu），截图不能证明中文所有字形可读；文字内容、交互、动画和几何断言已执行，不将字体环境问题混为代码回归。
- **真实日期门禁**：2026-10-13 UTC `scripts/preflight.sh` / `scripts/validate.sh` PASS（180 活动，既有 5 个 long-chip WARN），没有固定日期/放宽门禁/内容清理。static `app.js?v=24`，保护清单新增两个测试，未减少原 36 项保护；canonical/state、TODO、Spot Atlas、五个 AI bodies 未改。
- **限制/交付**：需要 HTTPS/localhost 的 Web Locks/AbortSignal；缺失、拒绝或排队超时明确不写入，关闭页面不保证等待异步保存。旧版本已打开标签需刷新为同一协议。未测 Safari/Firefox、真实手机/系统 IME，未跑真实模型/生产 solver、VPS/Caddy/cron/publish。PR 描述保留原文并追加验收；GitHub review thread 不自动 resolved，不声称状态被测试修复。普通 push 同一 PR，不合并、不部署。

## 任务 5/5：整体验收与 GitHub PR 交付（2026-10-13 UTC）

### 集成范围与额外修复
- 工作树开始时干净，GitHub 默认分支与远端 HEAD 均为 `main`（`e420502`），无开放 PR。仅纳入其后的任务 1–4 原提交 `634f187` / `252e6a0` / `b582ebe` / `6f86b7e`；从本地 `main` 新建 `feat/daily-timing-personal-reminders`，不改写原提交，不直接推送默认分支。
- 阅读相对远端 base 的完整改动及关联调用，保留单 agent 六责任顺序、committed-source 基线、失败快照和受保护范围；未新增 release 目录/版本固定/Caddy 配置，未部署 VPS、修改 cron 或运行真实模型日更。来源/runner 测试都在隔离 fixture 仓库中，发布脚本为 mock，不调用生产目标。
- **来源错误与指标**：官网 keyword 搜索读取到无新闻条目的可读空壳时，改为 partial 而非 complete-empty；Jina 明确 `Target URL returned error` 的全部 4xx/5xx（含 404/410/400）不能成为 last-good；fetch retry 输出真实 `kind:retry` 与请求 URL，不再被 summary 漏计或以临时输出路径冒充 URL。新增离线断言先在修复前失败，再用真实 fetch 指标喂给生产 summary 验证通过。
- **runner 前置依赖**：缺少 Git/jq/Node/Python 或不支持 Linux/readable `/proc` 时，必须在任何 agent 调用前拒绝。原实现 mock 缺失 Python 的 fixture 仍会启动 CLI，新增回归已复现并修复；恢复提示明确消费 `new --cached --json` 的 partial 报告。README/CLAUDE 列出运行依赖与新日志路径；Python 仅 stdlib，运行脚本/参考资料已纳入保护清单，无新增站点 runtime 包。
- **真实日期门禁**：按 10/13 UTC 的 90 天线 `2026-07-15` 定向删除两条结束于 7/14 的历史活动及英文条目（任务 4 记录的既有阻塞），同步维护待核实清单；无对应 featured/rich-region/processed-detail 悬挂引用，不修改时间门禁或固定真实验收日期。
- **形态抽屉衔接**：10/21 超级 Charizard X/Y 轮换包含两形态，原活动只登记 X，新的 form-aware matcher 会回退为空详情。实际读取既有 LeekDuck URL，确认两形态和 shiny；`fetch.sh zh 6` 返回 `NO-ZH-NAME`，继续使用该来源 proper name；确认 Y 的 sprite HEAD 为 200/image。补齐同一 canonical 行的两形态及 English 数组，保留原 ID/时间契约，不把形态核对扩大成推定全球提醒时间。真实 rotation→drawer 映射、纯函数正/负例及桌面/手机浏览器入口均检查通过。

### 本轮实际验收（均 PASS）
- `bash scripts/test-daily-reuse.sh`（含 daily candidates、error cache、partial 发现、同轮复用及新增真实 retry→summary fixture）。
- `bash scripts/test-run-daily.sh`（mock CLI，缺失依赖、静默/总时限、TERM/INT、抗 TERM 子进程、停止未知、scope/锁/HEAD/dirty、快照恢复失败、指标及原八文档一次性注入）。
- `node scripts/test-event-timing.js`（14 valid / 18 invalid、offset/DST/Node TZ/CLI gate）；`node scripts/test-event-reminders.js`（14 timing fixtures ±1ms、UTC+14→UTC−12、完成/撤销/到期、快照撤回、缺失/失败/数月留存、多标签 token/merge、debounce/IME、存储失败及调度）；`node scripts/test-spot-atlas-time.js`（24 个真实点位、25 点扩展及 World Clock）。
- `PLAYWRIGHT_MODULE=/workspace/.pi-tmp/browser-tools/node_modules/playwright-core node scripts/test-event-reminders-browser.js`：真实 Chromium 1440×1050 / 390×844，本地 HTTP + mock 活动/图片、固定时刻 + CDP IANA；桌面 >6s、手机月历及侧栏各 >3s 动画与几何/点击检查。重新补装沙箱 CJK 字体后读取了实际截图，确认彩虹流光/星芒/外发光与文案可读；reduced-motion、√ 恢复分类/精选、隐藏 +N、长期/PVP/跨周/raid 双形态、刷新/月份/语言/焦点/scroll、前后台、双标签删除中草稿不复活、失败加载/缺失清理/拒写均通过；零 page errors、无 nested buttons。新增已有双账号 TODO fixture（旧勾选/昵称/任务保持）和实际五个 English rich overlays 来回切换断言。截图/原始结果只在忽略的 `.pi-tmp/`。
- `scripts/preflight.sh` PASS（沿用原有 5 个超长 chip WARN）；`scripts/validate.sh` 在真实 **2026-10-13 UTC** PASS（180 活动，非 date fixture）。Bash/JS/Python 语法、`git diff --check`、全部 36 个 protected hashes PASS。
- 对照远端 base：TODO 原实现、五个中文 AI bodies、Atlas/featured/Mega/rotations/categories/meta 字节未变；`state.sources` / `state.details` 未推进。个人状态不进入 canonical/state，raw/cache/logs/font/Playwright/截图不提交。

### 尚待人工核实（不是本轮代码门禁阻塞）
- 180 条保留活动中，22 条双端时间完整、1 条开始已确认但截止未知、4 条日期已确认但时分未确认，153 条仍缺全部时间证据；共 158 条 pending 见 `docs/event-timing-review.md`。未知开始不允许完成；未知截止不自动删除；成功撤回替换快照，加载失败保留最后确认快照，canonical 移除只依可靠旧截止清理。不猜时间或把旧日历字符串视为精确时刻。
- 未测 Safari/Firefox、真实手机/系统 IME 与存储策略；Chromium 窄视口和 composition fixtures 不等于实机。未运行真实 Pi（CLI event/token 格式仍未验证，usage 保持 null）、生产来源日更、cron/Caddy/VPS。提醒没有关页后后台执行或系统推送承诺；来源漂移/主动 detached writer 沿用 fail-closed 和人工检查策略。合并与部署由用户决定。

## 任务 4/5：本地标星 / 笔记、月历侧栏与极光爆亮（仅本地开发）

### 范围与接口
- 从当前 `main` 的任务 3 基线 `b582ebe` 继续；宿主目录在 pi-box 挂为 `/workspace`，未回退/清场，没有改 canonical 活动内容、英文 overlay、daily state、精选清单或 Spot Atlas 数据。只修改 owner `app.js` / CSS / HTML shell / `ui.json`，保留五个 AI bodies 原样和既有静态架构；没有新 runtime 包、代理、后台服务、账户系统或通知权限。
- 完整用户状态/存储契约见 `docs/event-reminders.md`。独立 per-ID `pogo-event-reminders:v1:<encoded canonical ID>`，保存标星时间、完成、500 Unicode 字符纯文本 note、最小 timing 快照/指纹及缺失数据时的双语名称。无整表索引，不碰 `pogo-todo`；每条写前重读/核对，随机 incarnation guard 阻止删除后 debounce 复活，不同活动不会互相覆盖。同条最后成功写入；持续冲突保留草稿并明确提示。损坏/未知版本隔离、已知 v0 有界迁移；拒写继续会话并提示未持久化。拒写的删除恢复存储后重试，但不能声称不可写磁盘上的旧字节已清除。
- 复用任务 3 `resolveEventTiming`，保持其 API/UTC+14/UTC−12/地区 IANA/absolute/部分边界语义。成功 canonical 加载才更新快照；撤回/TBD 替换旧精确值；缺失/失败不当到期。旧标签校准或写 note 不会把旧 canonical 时间覆盖较新标签的成功快照，失败 reload 也不重新声明旧时间。缺失事件依最后确认的 finite close 清理；未知 close 保留待核实。完成/撤销跨周、跨月、刷新、语言保持，多日只做一次，已知 close 直接删除整条，不归档。
- 同一派生状态同步 bars / chips / 长期 / PVP / 明确映射的 raid badges；raid 匹配确认日期、全池和形态，歧义/无 ID fallback 不开放新标星。隐藏提醒使 `+N` 明显高亮，并可键盘打开完整列表。标星/完成操作只在独立按钮，不嵌套 button 或误触详情。
- 桌面 sticky 全月份清单；手机折叠入口吸附，展开回正常流推下日期。进行中、未来、未知分组，完成折叠可撤销；UTC−12 截止显示浏览器当地完整日期 + GMT 偏移 + IANA。语言切换保留 textarea 节点/输入；自动保存处理 composition、失焦/关闭/pagehide flush、到期 cancel。笔记以文本显示、不翻译。修复窄屏 header 语言按钮遮挡抽屉 X，留出独立工具栏空间。
- 极光采用统一 3s 彩虹流动、2s 外发光 / 双星芒，仅 active+flagged+未完成挂类；√/取消/到期恢复原分类和 featured，✨ 保持原义。reduced-motion 仍醒目但静止。单一最近边界 timeout + 最长 30s 校准，visibility/pageshow/focus/storage/load 唤醒；后台暂停，校准不重建月历/编辑器、不抢焦点或滚动。缓存已验证 IANA 与提醒日期 formatter，避免所有副本反复构造 Intl 对象；不缓存当前 UTC offset、不改 Spot Atlas 时间算法。
- Node-exported `createEventReminderStore` / `deriveEventReminder` / `reminderTimeSnapshot` / `decodeReminder` / `createReminderNoteSaver` / `createReminderScheduler`，可注入 storage、now、viewerTimeZone、token 与 timers。所有 runtime helper 仍在已受保护 `app.js`；两个新增测试也进入 `scripts/protected.sha256`，保护/恢复规则、六责任顺序和发布门禁未放宽。

### 实际测试
- `node scripts/test-event-reminders.js` — PASS：完整标星→等待→Kiritimati 开始→完成→撤销→UTC−12 清理；复用 14 个任务 3 timing fixtures 的双端 ±1ms；同 ID 更正/撤回、旧标签时间反写保护、缺失/数月未打开、读写失败/损坏/v0、Unicode/IME/取消/到期与 autosave、不同 ID 合并/同条 CAS 竞争/删除再标星、存储恢复清理、最近边界和跨渲染补算。
- `PLAYWRIGHT_MODULE=/workspace/.pi-tmp/browser-tools/node_modules/playwright-core node scripts/test-event-reminders-browser.js` — PASS，Chromium 1440×1050 / 390×844；桌面 >6s、窄屏月历与侧栏各 >3s 运行动画，实际截图检查了多帧颜色移动/外发光/星芒、字与按钮可读可点，绿/蓝/红三种原分类通用效果；验证 √ 恢复原红色及精选、隐藏 +N、跨周/长期/PVP/raid/手机 chooser/fallback、reload/月/语言、输入/焦点/scroll、CDP IANA 切换、前后台/pageshow、双标签删除中草稿不复活、加载失败与留存、拒写、TODO/Atlas/世界时钟。零 page errors、无 nested buttons。只用临时本地 HTTP / mock 数据与图像；playwright-core、Noto CJK 仅沙箱开发依赖，截图/结果在忽略的 `.pi-tmp/reminder-browser/`，不提交笔记或大日志。
- `node scripts/test-event-timing.js`、`node scripts/test-spot-atlas-time.js`、`bash scripts/test-daily-reuse.sh`、`bash scripts/test-run-daily.sh` — 全部 PASS（无真实 CLI、模型或发布）。
- `scripts/preflight.sh` — PASS，沿用原有 5 个超长 chip 警告。`scripts/validate.sh` 在 UTC **2026-10-12** 本任务中真实运行 PASS；最终代码以仅固定 90 天截止为 **2026-07-14** 的临时 `date` fixture（对应任务 3 内容快照 UTC 2026-10-12）复跑全部门禁 PASS，checksum PASS。
- **真实 UTC 2026-10-13 的门禁既有失败**：测试期间跨日，`validate.sh` 因两条结束于 7/14 的历史行越过 90 天线而 FAIL：`articuno-zapdos-moltres-in-5-star-raid-battles-july-13-2026`、`mega-lucario-in-mega-raids-july-13-2026`。隔离 `git archive HEAD` 的原任务 3 基线同样 FAIL，仅此两行；本任务没有改数据或放松 retention。下一内容维护需正常按 90 责任清理对应 canonical / English / featured / 引用，不能把这个日期问题当本次 UI 回归或生产已通过。

### 下一任务依赖 / 未验证
- 直接复用上述时间和提醒接口、版本化 key、token guard、plain-text note 与测试；不要新增另一个时间计算器/整表 writer，或把个人记录混入每日内容。若任务 5 涉及交付/发布，应完整带上 owner shell / `app.js?v=23` / `style.css?v=26` / 双语 `ui.json` 和保护清单，先处理真实日期的既有内容留存问题；本轮没有部署。
- 未实测 Safari/Firefox、真实手机/系统输入法或系统权限策略；IME 为 composition 事件 fixtures，390px 是真实 Chromium 窄视口非手机实机。没有验证真实 Pi 日更、未来内容源更正、生产 cron/Caddy/VPS。关页不承诺后台执行或推送，依当前浏览器钟，下次打开补清理。


## 任务 3/5：事件时间契约与纯提醒边界（仅本地开发）

- `docs/event-timing.md` 是字段/语义契约：保留原 `id`、日历 `start/end` 日期与双语结构，每条 `events.json` 必须有 `timing:{scope,mode,startPrecision,endPrecision[,timeZone]}`。`scope` 和 `mode` 分离；区域 local 的 IANA 由确切单一场地支持，未知不猜。`date`/`unknown` 不制造提醒时刻；两端独立可空。全局 local 精确开始取 `Pacific/Kiritimati`（UTC+14），结束取固定 UTC−12（非 UTC−11/Etc/GMT-12）；absolute 用显式 `Z/±HH:mm`，区域 local 用活动当天 IANA（DST gap 前移 / fold 取较早）。边界半开 `[openAt,closeAt)`；无精确截止不自动删除。历史数据 90 天留存依据日历结束日期而非提醒 closeAt；`end:null` 不以 start 伪造截止。
- **任务 4 可直接复用的函数**：`public/app.js` 导出 `parseEventTime(value) -> {parts,date,hasTime,hasOffset,instant}|{error}`，`validateEventTiming(event[, {allowLegacy:true}]) -> string[]`（旧兼容只供显式调用，发布门禁始终 strict），`resolveEventTiming(event, now, viewerTimeZone) -> {openAt:Date|null, closeAt:Date|null, viewerWindow:{start:{instant:Date,date,time,...}|null,end:{...}|null},viewerTimeZone,status:'upcoming'|'active'|'expired'|'unknown'|'error',reason:string|null}`。`now`、浏览器 viewer IANA 必须显式给入任务 4 的提醒计算；不要从已格式化的 `viewerWindow` 反推提醒边界，也不要用 `parseDay()` 的日历日期算瞬间。缺少范围/模式即使墙钟已知仍 `unknown`、不提醒；已知 absolute 可以在范围未知时给出时刻，但不能声称全球可参加。`openAt` 与 `closeAt` 比较时刻，`closeAt` 当刻直接 expired。无个人状态存储或提醒 UI，本轮未实现任务 4。
- `scripts/daily-candidates.js` 重用此纯函数筛当前/近七天；不完整 timing 的前后最多允许 UTC+14 / UTC−12 的**保守候选提示**，`dateChecksAreHints:true`、`uncertainTimingIds` 显式标记非证实状态。待确认范围/模式/任一边界即使远于七天也作为 `pending-timing` 详情候选；强制、历史保留与 committed-source 基线不变。`scripts/check-event-timing.js` 在 preflight 和 validate 均强制运行，拒绝日历溢出、非法 offset/组合、倒置精确边界和缺少 timing；事件跨 DST 的折叠/缺口复用 Spot Atlas 算法。无新生产调度/模型变更。
- 迁移（2026-10-12 快照）：保留 **182** 条，证实双端精确 **22** 条；开始精确而结束未公告 **1** 条，日期已核实但具体时分待确认 **4** 条，其他范围/时间未核实 **155** 条。单独清理 >90 天的旧 `max-mondays-2026-07-13` 及对应英文 overlay；一项 GBL 10/27 开始原为 21:00Z，经来源核实改成 20:00Z；野外活动城市 UTC 原值换算为举办地墙钟+IANA，GO Tour 日期占位变成纯日期。当前证据的 URL/短依据在 `data/state.json.timingEvidence`，全部 **160** 条仍需部分或全部核验的 ID 见 `docs/event-timing-review.md`；仅正文实际读取才标已证实，未把本次 fetch 材料误写为 `state.details` processed，原 `sources` 和 `details` 基线未变。`public/data/i18n/en.json` 仅因该过期 ID 移除一项，无结构时间复制。
- 离线测试：`node scripts/test-event-timing.js`（14 valid / 18 invalid、Node TZ、两个门禁入口模拟）PASS，`node scripts/test-spot-atlas-time.js` PASS，`bash scripts/test-daily-reuse.sh`、`bash scripts/test-run-daily.sh` PASS；`scripts/preflight.sh` PASS（既有 5 条超长 chip 警告）；`scripts/validate.sh` PASS。均未调用 Pi/真实日更/生产发布。已更新 `scripts/protected.sha256`。
- 未验证：真实 Pi CLI、目标环境 cron/Caddy/VPS 和生产内容来源未来更新；未对所有旧活动逐条重抓，`docs/event-timing-review.md` 是待核实列表；第三方未来更正需下一轮 fetch 再更新。个人状态清理、提醒 UI 属任务 4。

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
