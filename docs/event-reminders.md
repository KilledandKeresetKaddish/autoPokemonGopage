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
- 每次单条修改重新读 key，并在写前核对；合并 note/completion 字段，冲突有限重读。相同活动同时编辑按最后成功写入处理。autosave 带 `token`，删除/重新标星后旧输入不能复活记录；持续冲突保留输入并提示未保存。
- 拒写/读失败保留会话状态并明确提示未持久化。存储恢复时可重试尚未落盘的删除；另一标签成功写入的新 incarnation 优先。无法写存储时不能承诺磁盘字节已删除，下次打开仍会按已知 close 重试清理。
- 损坏/不支持版本的 key 原样隔离，不覆盖，不阻塞 TODO 或整站。仅支持已知旧 envelope `pogo-event-reminders={v:0,events:{id:{starredAt,completedAt,note,name?,enName?,time?}}}`：逐条迁移，不覆盖 v1；未知旧格式保留待核实，裸 `closeAt` 不作为时间证据。

## 前端接口与调度

所有实现仍在受保护的 `public/app.js`；纯函数/存储/调度接口 Node-exported：

- `reminderTimeSnapshot`、`decodeReminder`、`deriveEventReminder`
- `createEventReminderStore({storage?,now?,viewerTimeZone?,token?})`：`setEvents(events,englishNames)` / `sync` / `refresh` / `get` / `entries` / `view` / `status` / `star` / `remove` / `note` / `complete`。写接口返回 `{ok,persisted,record}` 或 `{ok:false,reason}`；编辑和删除可带预期 token。
- `createReminderNoteSaver(store,{setTimeout?,clearTimeout?,delay?,onSave?})`：350ms debounce，composition 暂停；失焦、关闭、pagehide 会 flush。到期/跨标签删除取消草稿。
- `createReminderScheduler({refresh,boundaries,now?,setTimeout?,clearTimeout?,isHidden?})`：单一最近边界 timeout、最长 30 秒校准；跨过渲染期间边界立即补算。后台停调度/动画，visibilitychange/pageshow/focus/storage/数据加载立即补算，不保证关页后执行。

月历跨周条、chips、长期/PVP 条及明确可映射的 raid badge 只绑定真实 ID；歧义池/不同形态或无 ID fallback 不开放新提醒。隐藏 chips 的 `+N` 是完整列表按钮，也派生隐藏提醒的发光状态。校准只同步节点，不重建月历或编辑器；切语言保留 textarea 节点、输入和状态。桌面 sticky；手机折叠入口吸附，展开面板回到正常流、推下日期，不固定覆盖日期或抽屉关闭按钮。所有正式文案在 `ui.json` 双语 key 中。

极光是统一的 3 秒彩虹流动 + 2 秒外发光 / 双星芒，不按类别改色。仅未完成 active+flagged 挂动画类；reduced-motion 为同样醒目的静态彩色处理，无新增设置页。

## 测试

```bash
node scripts/test-event-reminders.js
node scripts/test-event-timing.js
node scripts/test-spot-atlas-time.js
bash scripts/test-daily-reuse.sh
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

该脚本本地临时 HTTP、mock canonical/overlay/外链图像、可注入 Date/IANA；1440×1050 / 390×844 实跑持续动画与点击，截图只在 `.pi-tmp/reminder-browser/`。真实 ±1ms 和调度竞争由纯时间 fixtures / fake timers 覆盖，不用冻结的浏览器钟驱动 1ms 无限校准。没有真实模型、发布目标或生产部署。实际结果及历史内容日期门禁说明见 [实现交接](implementation-handoff.md)。
