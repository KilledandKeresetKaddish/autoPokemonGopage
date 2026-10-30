# 本地标星、笔记与提醒（任务 4）

这是当前浏览器的个人清单，不按游戏账号分组，不上传、不云同步；可由用户主动授权，额外显示本机系统通知。`pogo-todo`、管理员 `featured.json` 和色违 `highlight` 完全独立；不会随 TODO 清空或每天重置。所有身份只使用 canonical `event.id`。

## 状态

时间仅复用 [任务 3 契约](event-timing.md) 的 `resolveEventTiming`，不从日历日期或标题制造时刻。

- 未标星：原分类 / 管理员精选 / 色违标识，详情可标星。
- 已标星、`now < openAt`：原分类颜色加 ★；不能完成，显示何时可完成。
- `openAt <= now < closeAt`：未完成时月历所有副本和侧栏卡片持续“星轨”金光，收起的侧栏入口同步发光，可 √。全球 local 开始按 Kiritimati；本地尚未开始另列倒计时。
- 完成：保存 `completedAt`，停止所有提醒动画，恢复原分类 / 精选样式，显示 √；截止前可以撤销。多日活动只完成一次。
- 已知 `now >= closeAt`：删除整条个人记录及笔记、取消待执行 autosave；活动本体仍在日历，不能再标星。全球 local 截止是固定 UTC−12，UI 显示换算后的完整日期、偏移和浏览器 IANA。
- 开始未知不能完成；截止未知不猜删除时间。明确开始而截止未知可完成和撤销。
- 手动取消标星删除整条记录；有笔记（包括尚未保存的输入）时先确认。无笔记历史或到期归档。

## localStorage 协议

每个活动一条版本化 key：`pogo-event-reminders:v1:<encodeURIComponent(event.id)>`。没有共享整表或索引，避免两标签同时修改**不同活动**互相覆盖。

```text
{ v:1, id, token, starredAt, completedAt:null|epochMs, note,
  names:{"zh-CN":canonicalName, en:overlayName},
  time:null|{start, end, timing, fingerprint} }
```

- `starredAt` / `completedAt` 是毫秒 epoch；`token` 是这次标星的随机 incarnation，不是活动 ID。
- `note` 为纯文本、最多 500 个 Unicode code point；中文/英文不翻译，emoji 不截断代理对。DOM 使用 `textContent` / `textarea.value`，不执行 HTML/Markdown。
- `time` 只复制经过现有 strict timing 校验的最小事实；`fingerprint` 是这些事实的确定性 JSON，不保存猜测时刻。两端可独立未知。两种名称仅供 canonical 被历史留存删除/加载失败后的清单显示。
- 成功加载 canonical 时更新已有记录的快照，保留未到期笔记和人工完成。明确撤回的边界覆盖旧精确边界；无效时间撤为 `null`。加载失败不当作撤回。
- 普通校准和 note/completion 写入使用记录中最新成功加载的快照；老标签页不会把它自己的旧 canonical 时间每 30 秒写回，或依旧截止提前删除。显式成功数据加载才重新声明时间权威。
- canonical 暂缺：最后确认的有限 close 仍能清理数月前已被留存机制删掉的活动；没有可靠 close 则保留待核实。
- 详情和侧栏按钮在点击时、任何 await 前固定控件当时显示的目标（标星 / 取消 / 完成 / 撤销）及预期 token；刷新仅用于核对，不再根据刷新后的存在性/完成状态 toggle。同向操作幂等；旧 token 命令不操作删除后重标星的新 incarnation；锁内仍复核截止。同活动仍防重复提交，取消仍确认，失败删除保留仍适用的草稿。
- 编辑器重建/同步优先使用**同 token**的最新 pending 草稿（等待中或失败均如此），E→F→E 不拿旧持久化文本替换它，再借 blur 写回旧值。重复 blur/flush 共用原 flight；删除、到期或新 token 才使旧草稿失效。当前编辑/IME 与语言切换保留节点，旧回调不能恢复被取消的草稿。
- **所有写路径共享同源 Web Locks 排他锁 `pogo-event-reminders:v1:`**：标星、取消、笔记、完成、到期清理、成功 canonical 快照、v0 迁移和恢复重试都先拿锁。锁内同步执行最新读取、token / 时间判定、字段合并及最终 set/remove，中间不等待另一操作。单标签队列或 get→set 核对本身不是跨标签 CAS。
- 正确性：同一时刻最多一个协议 writer。若旧笔记先取得锁，则其写入先完成，随后取消/到期删除；若删除先完成，则笔记锁内重新读取不到旧 token，拒绝写入。删除后重标星的新 token 同样拒绝旧输入；同条 note/completion 合并锁内最新记录，不同活动保留独立 key。
- **兼容限制**：需要安全上下文（HTTPS，测试 localhost）且有 `navigator.locks.request` / AbortSignal。能力缺失、调用拒绝或排队 5 秒超时返回 `reason:"locking", persisted:false`，不修改个人记录、不走无锁回退；UI 明示未写入，草稿留待编辑/失焦重试。关闭持锁标签由浏览器释放锁，无持久租约。上线后旧版本已打开标签必须刷新；此保证针对使用同一协议的页面，不能约束旧代码/开发者工具直接写 localStorage。
- 获取锁失败时，显式成功加载的 canonical 等待下一次受保护操作重试，在清理/人工修改前应用；成功应用后普通 refresh 不重复声明旧 canonical 权威。存储读取/写入失败仍走原会话 overlay，只在实际落盘后报告 persisted。
- 拒写/读失败保留会话状态并明确提示未持久化。存储恢复时可重试尚未落盘的删除；另一标签成功写入的新 incarnation 优先。无法写存储时不能承诺磁盘字节已删除，下次打开仍会按已知 close 重试清理。
- 损坏/不支持版本的 key 原样隔离，不覆盖，不阻塞 TODO 或整站。仅支持已知旧 envelope `pogo-event-reminders={v:0,events:{id:{starredAt,completedAt,note,name?,enName?,time?}}}`：在同一锁内逐条迁移，不覆盖 v1；删除同时清理已知 v0 中对应条目，防止部分迁移后复活；未知旧格式保留待核实，裸 `closeAt` 不作为时间证据。

## 前端接口与调度

所有实现仍在受保护的 `public/app.js`；纯函数/存储/调度接口 Node-exported：

- `reminderTimeSnapshot`、`decodeReminder`、`deriveEventReminder`
- `createEventReminderStore({storage?,locks?,now?,viewerTimeZone?,token?})`：`ready` 是初始迁移 Promise；`setEvents(events,englishNames)` / `refresh` / `star` / `remove` / `note` / `complete` 都返回 Promise，调用方须 await。人工写接口 resolve `{ok,persisted,record}` 或 `{ok:false,reason}`；只有 `persisted:true` 表示写/删成功落盘。`sync` / `get` / `entries` / `view` / `status` 保持同步只读；status 新增 `lockingUnavailable`。测试注入同一个锁管理器，不用无锁默认 fixture；编辑和删除带预期 token。
- `createReminderNoteSaver(store,{setTimeout?,clearTimeout?,delay?,onSave?})`：350ms debounce，composition 暂停；`flush` / `flushAll` 返回 Promise。同一草稿重复 flush 共享 flight，等待中不显示已保存；rejection 保留输入并提示未保存，较新/取消的草稿不受旧回调影响。失焦、关闭抽屉、visibility/pagehide 发起 flush；pagehide/关页仅尽力尝试，**浏览器不保证等待异步保存**。正常输入和失焦及时保存，但最后一瞬关页可能丢失尚未确认的输入。到期/跨标签删除取消草稿。
- `createReminderScheduler({refresh,boundaries,now?,setTimeout?,clearTimeout?,isHidden?})`：单一最近边界 timeout、最长 30 秒校准；跨过渲染期间边界立即补算。异步 refresh 合并唤醒为一个 flight，pause 不让过时回调重挂计时器；后台停调度/动画，visibilitychange/pageshow/focus/storage/数据加载立即补算，不保证关页后执行。

月历跨周条、chips、长期/PVP 条及明确可映射的 raid badge 只绑定真实 ID；歧义池/不同形态或无 ID fallback 不开放新提醒。隐藏 chips 的 `+N` 是完整列表按钮，也派生隐藏提醒的发光状态。校准只同步节点，不重建月历或编辑器；切语言保留 textarea 节点、输入和状态。桌面（>1000px）提醒栏是视口右缘的 ⭐ + 数量入口，不占日历列或右边距。支持 hover + fine pointer 时，悬停或键盘焦点进入即覆盖展开；鼠标与焦点均离开后收起，列表在面板内滚动。大屏触屏使用同一个原生 details 入口点击开合。跨 1000px 断点或 hover/fine 能力切换时收起，不保存展开偏好。手机折叠入口吸附，点击展开后仍回到正常流、推下日期；没有手机悬浮抽屉。侧栏仅随日历视图显示，层级低于活动详情。

详情顶部的分类 tag 与 ⭐ / ✔ 同行；语言/关闭按钮仍占独立工具栏空间。图标为真实 button，`aria-pressed` 表示标星/完成状态；不可用动作以 `aria-disabled` 保持可聚焦，并在同步点击守卫中拒绝执行。简短双语动作/原因同时由 aria-label、aria-describedby 和 hover/focus tooltip 提供；不是原生 disabled title。完成可撤销，仍受原有时间门槛约束。未标星时不显示空笔记卡片；标星后下方仅挂载一个编辑器。动作节点由编辑器持有引用，切语言时一并复用，不能通过复制 textarea 解决布局。存储失败、草稿和冲突反馈仍保留。所有正式文案在 `ui.json` 双语 key 中。

进行中提醒为统一的“星轨”处理（黑金塔罗主题）：保留原分类底色并加金色薄纱，1.8 秒呼吸的实心金环外发光、0.8 秒行进的亮金虚线框，以及沿上沿移动的 ✦ 彗星和末端闪烁星芒。收起的侧栏入口在存在进行中提醒时加 `.has-live`：同节奏发光、星标外环绕行小点、数量徽章变金；桌面端每 9 秒向左探出第一个进行中活动名称（多个时附 `+N`）。仅未完成 active+flagged 挂动画类；reduced-motion 为同样醒目的静态金环处理，无新增设置页。

## System notifications（系统通知）

侧栏顶部提供「启用系统通知」。仅此按钮的点击处理器直接调用 `Notification.requestPermission()`（Firefox 必须有用户手势）；默认关闭，不会自动询问。授权后有开关、全球开始 / 本地开始 / 两者（默认）及「发送测试通知」。拒绝后按提示在地址栏左侧权限图标重新允许，再开启；不支持 Notifications API 或非 HTTPS/localhost 时只显示说明。无精确开始时间的已标星活动显示计数提示，绝不猜零点。

- **唯一时间来源**仍是 `reminders.sync()` → 每个 `entries()` 的 `view(id)`；每次检查先重新检测浏览器 IANA 并更新 `reminderViewerZone`，旅行后本地开始会随之调整。不新增时间换算器，不写 `pogo-event-reminders:v1:*`，不获取其 writer 锁，不调用 `refresh()`，不在后台渲染 UI 或清理到期个人记录。原 `createReminderScheduler` 的后台暂停/动画契约不变。
- `open` = `view.openAt`（全球 local 为 Kiritimati / UTC+14；regional / absolute 为真实开始）；全球 local 的 `local` = `view.viewerWindow.start.instant`。两者相同只发一次 `open`；只有一个实际开始的 regional / absolute 在任一时刻偏好下也仅发一次 `open`。开始未知/错误不发，完成不发，`now >= closeAt` 不发。截止未知不制造截止。
- 边界为 `now >= moment`；重开、恢复、回前台、focus、storage、数据加载时补发错过但仍进行中的开始，正文含「多久前开始 · 仍在进行中」。`starredAt >= moment` 只静默记账，不补发；取消标星清除对应通知账本，新 token 重新评估。账本按实际 instant 判断，延期、提前等 canonical 更正和旅行带来的本地时刻更正会重新评估。
- **启用基线**：首次通过按钮授权/从关闭切到开启，在通知锁内先静默记录所有已到的开始（包含未选的时刻），再公布开启设置，避免旧提醒爆发。普通已启用页面重开不建新基线，必须补发；另一标签晚观察到授权也不能重建基线吞掉较新的开始。之后修改时刻偏好不重新建基线。
- 同一检查有 ≥3 个待通知时只构造一个汇总，列前三个活动名称及 `+N`，记账涵盖全部候选；单条点击聚焦窗口、复用主标签切换到日历并打开 canonical 详情，已不在日历的记录/汇总/测试则展开提醒栏，最后关闭通知。语言跟随 `state.locale`，名称先用记录的对应语言，再退回 canonical / zh-CN / id；时间/时长复用 `reminderInstant()` / `reminderRemaining()`。

### 独立存储与跨标签协议

```text
pogo-event-notify:v1:settings
  {v:1, enabled:boolean, moments:'both'|'open'|'local'}
  默认 {v:1, enabled:false, moments:'both'}
pogo-event-notify:v1:fired:<encodeURIComponent(id)>
  {v:1, token, open:epochMs|null, local:epochMs|null}
```

专用 Web Lock **`pogo-event-notify:v1:`** 内重新读取设置、个人记录和 sent 账本，完成 decide → 构造 Notification → mark（同步临界区）。它不与个人 writer 共用锁，不阻塞笔记/完成操作。删除无对应记录或 token 已变的 sent；损坏 sent 按未发送处理并在需要时覆盖，绝不影响个人记录。构造失败不吞掉该次提醒。未授权、关闭、不支持或非安全上下文时不发送也不写 sent；清理在下次已启用检查完成。

没有 Web Locks 或无法取得时，通知采用 read → notify → write 的尽力回退，并以 `pogo-event-notify:<id>:<open|local>` tag 作第二层去重，汇总 tag 固定为 `pogo-event-notify:summary`。这里不同于个人 writer 的 fail-closed：偶发重复通知成本低，错过通知恰好违背此功能目标。存储不可用时不能保证跨会话去重/设置保存。

### 后台、Windows 与限制

独立单一 timeout 在最近未来开始前唤醒，最短 1 秒、最长 60 秒；`document.hidden` / 窗口最小化不暂停该轻量检查。visibilitychange（包括隐藏）、pageshow、focus、相关 storage（也含 clear）、数据加载立即合并唤醒，一次只运行一个检查。pagehide 暂停该 timeout，pageshow 恢复。浏览器后台节流、休眠及系统调度可推迟提示，恢复后仍按当前时刻补发。

**页面关闭、卸载/discard 或电脑关机时没有任何代码运行**；没有服务器、Service Worker 或 Push API，不承诺关页提醒。下次打开/恢复只补发尚未结束且未完成的活动。保留固定标签、在 Auto Tab Discard 中设置始终保留站点可避免常见卸载，但不是系统级闹钟。

所有通知（包括测试）使用 `requireInteraction:true`、tag 及站点图标，不设置 `silent:true`。Windows Firefox 117+ 支持保持显示与关闭按钮；实际呈现仍由浏览器/Windows 控制，须由机主实测。**Windows「请勿打扰」会直接送入通知中心而不弹横幅**；确认 Windows 设置 → 系统 → 通知 → Firefox 的横幅已开且请勿打扰已关。真实 Firefox/Windows 的权限、右下角弹出、保持显示及点击聚焦不能由 Node/Chromium fixtures 证明。

接口均在 `app.js` 并 Node-exported：`dueReminderNotifications({entries,view,fired,settings,now,viewerTimeZone,baseline?})` 返回 `{notify,ledger}`（ledger 是 `{id,token,moment,instant,silent}` patch 数组），不修改输入；`createReminderNotifier({store,storage?,locks?,now?,setTimeout?,clearTimeout?,Notification?,isSecure?,getLocale?,getViewerTimeZone?,onViewerTimeZone?,translate?,formatInstant?,formatRemaining?,getCanonicalName?,onClick?})` 提供 `wake`（合并 flight）、`pause`、`configure`（开启时基线）、`settings`、`status` 和 `test`。注入项仅用于测试/适配，运行时无新增脚本、依赖或构建步骤。

## 测试

```bash
node scripts/test-reminder-notify.js # 独立通知逻辑、锁、后台与真实设置处理器 fixtures
node scripts/test-event-reminders.js # 包含 test-reminder-concurrency.js / test-reminder-ui.js
node scripts/test-event-timing.js
node scripts/test-spot-atlas-time.js
bash scripts/test-daily-reuse.sh # 包含 test-fetch-retries.sh
bash scripts/test-run-daily.sh
scripts/preflight.sh
scripts/validate.sh
```

可选真实 Chromium 测试（只在沙箱安装开发依赖，无 app runtime 依赖）：

```bash
npm install --prefix /workspace/.pi-tmp/browser-tools --no-audit --no-fund playwright-core@1.56.1
PLAYWRIGHT_MODULE=/workspace/.pi-tmp/browser-tools/node_modules/playwright-core \
  node scripts/test-event-reminders-browser.js
```

该脚本还使用同一 context / origin 的多 page + 真实 Web Locks 排队屏障通过真实详情/侧栏按钮验证完成/完成、取消/取消、撤销/撤销、标星/标星、旧命令/重标星、锁排队跨截止、失败/flight 中 E→F→E 和实际 textarea/blur；并验证笔记/删除竞争、重标星 token、关持锁标签自动释放、5 秒获取超时及能力缺失/拒绝；屏障由测试外部释放，不让持锁者等待另一个同锁写入。该脚本本地临时 HTTP、mock canonical/overlay/外链图像、可注入 Date/IANA；1440×1050 / 1920×1050 / 390×844 实跑持续动画与点击：检查完整主容器宽度、展开前后日历 bounding box 不变、右缘入口/离开/Tab/内部滚动、真实 CDP coarse-touch 点击和跨断点复位，以及详情 tag/双图标几何、不重叠的 hover/focus 说明、未标星编辑器隐藏、手机详情滚动/关闭。Chromium CDP 关闭 touch 模拟后会报告 pointer:none，故真实 fine→coarse 能力切换隔离到单独 page，不影响后续鼠标测试。截图只在 `.pi-tmp/reminder-browser/`，包括 `desktop-{1440,1920}-{collapsed,expanded}.png`、`desktop-detail-icons.png`、`phone-detail-icons.png` 和 `phone-touch-panel.png`。真实 ±1ms 和调度竞争由纯时间 fixtures / fake timers 覆盖，不用冻结的浏览器钟驱动 1ms 无限校准。正常动画/几何检查结束后，多 page 逻辑阶段启用 reduced-motion 以避免单 CPU 沙箱的无关绘制饥饿，仍断言日历/侧栏派生状态；新增独立 context 的 1/3 条提醒斜向移入（逐步命中、标题左缘/透明左上角及实际点击），长列表复用同一路径；键盘详情往返覆盖 Escape/关闭按钮、已完成折叠组、取消/跨页删除/到期及切换主视图后的焦点降级。完整测试有 240 秒硬上限。没有真实模型、发布目标或生产部署。实际结果及历史内容日期门禁说明见 [实现交接](implementation-handoff.md)。
