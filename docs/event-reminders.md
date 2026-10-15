# 本地标星、笔记与提醒（任务 4）

这是当前浏览器的个人清单，不按游戏账号分组，不上传、不云同步，不请求通知权限或提供系统推送。`pogo-todo`、管理员 `featured.json` 和色违 `highlight` 完全独立；不会随 TODO 清空或每天重置。所有身份只使用 canonical `event.id`。

## 状态

时间仅复用 [任务 3 契约](event-timing.md) 的 `resolveEventTiming`，不从日历日期或标题制造时刻。

- 未标星：原分类 / 管理员精选 / 色违标识，详情可标星。
- 已标星、`now < openAt`：原分类颜色加 ★；不能完成，显示何时可完成。
- `openAt <= now < closeAt`：未完成时月历所有副本和侧栏持续极光流光，可 √。全球 local 开始按 Kiritimati；本地尚未开始另列倒计时。
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

极光是统一的 3 秒彩虹流动 + 2 秒外发光 / 双星芒，不按类别改色。仅未完成 active+flagged 挂动画类；reduced-motion 为同样醒目的静态彩色处理，无新增设置页。

## 测试

```bash
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
