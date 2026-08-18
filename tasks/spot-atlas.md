# Spot Atlas 任务书修订：浏览器本地时间 + 单一地点名

> 本文件是在当前仓库中新增的 Spot Atlas 覆盖规范。若它与旧任务书中关于
> `nameZh`、`nameEn`、`Asia/Shanghai`、`中国时间`、`chinaTime` 或
> `displayTimeZone` 的要求冲突，以本文件为准；其余旧要求保持不变。

## 1. 修订目标

1. 每个地点只保留一个原始名称字段 `name`，网站 locale 切换不得改变它。
2. 每个地点的目标时刻仍为该地点当地的每周二 20:00。
3. 目标 instant 的展示时区由浏览器运行时动态决定，不在数据中保存，也不与网站语言绑定。
4. 时区计算必须基于 IANA timezone，正确处理 DST、半小时时区和日期跨越。
5. validation、preflight、i18n 和测试同步迁移到新 schema 与新显示语义。

---

## 2. `locations.json` 顶层结构

顶层结构改为：

```json
{
  "schemaVersion": 1,
  "schedule": {
    "isoWeekday": 2,
    "hour": 20,
    "minute": 0
  },
  "spots": []
}
```

字段含义：

- `isoWeekday: 2`：周二；ISO weekday 中周一为 `1`、周日为 `7`。
- `hour: 20`、`minute: 0`：每个地点自身当地时间的目标时刻为周二 20:00。
- `locations.json` 中不得保存 `schedule.displayTimeZone`。
- 不得在其他数据字段中变相保存固定展示时区。

---

## 3. Spot schema：单一地点名

每个 spot 使用以下结构：

```json
{
  "id": "stable-url-safe-id",
  "countryCode": "TH",
  "name": "Ban Phue",
  "lat": 17.688021,
  "lng": 102.473581,
  "timeZone": "Asia/Bangkok",
  "kind": "gym",
  "status": "tested",
  "group": null,
  "rating": null,
  "needsReview": false,
  "note": "人少、资源也较少"
}
```

### 3.1 名称规则

删除：

```text
nameZh
nameEn
```

统一改为：

```text
name
```

要求：

- `name` 必填，必须是 trim 后非空的字符串。
- `locations.json` 是地点名称的唯一数据源。
- 地名本身不参与 zh-CN / en UI 翻译。
- 中文页面和英文页面始终显示完全相同的 `spot.name`。
- 不得为了英文 locale 自动翻译、音译、改写、重排或替换地点名称。
- 后续用户修改地点名时，只修改 `name`。
- 地名可以自然包含中文、英文或混合文字，例如：

```text
Ban Phue
吉大港①
迈索尔 Mysuru
图卢兹南郊
Lahore｜Jilani Park
科罗拉多州｜Montrose｜Fox Park
```

### 3.2 初始 23 个地点迁移

将每条现有数据中的：

```json
"nameZh": "...",
"nameEn": "..."
```

合并为：

```json
"name": "..."
```

保留其他字段及地点身份不变。名称按现有 23 个地点的对应顺序/身份使用以下值：

```text
Ban Phue
吉大港①
迈索尔 Mysuru
图卢兹南郊
宾夕法尼亚州｜York
德州｜Bryan–College Station
Matehuala ①
Matehuala ②
塞萨洛尼基北部
Namangan 候选点
Andijan 候选点
Fergana 候选点
Islamabad｜Lok Virsa文化区
Lahore｜Jilani Park
Lahore 候选点②
Lahore 候选点③
Kuantan 候选点
科罗拉多州｜Montrose｜Fox Park
亚利桑那州｜Sierra Vista｜Len Roberts Park
Sonora 候选点
俄勒冈州｜Redmond 候选点
吉大港②
吉大港③
```

切换网站语言时不得改变上述名称。

---

## 4. 浏览器展示时区

页面加载时必须自动获取当前浏览器的 IANA timezone：

```js
const browserTimeZone =
  Intl.DateTimeFormat().resolvedOptions().timeZone;
```

生产环境中的展示时区必须等于运行时得到的 `browserTimeZone`。

### 4.1 安全 fallback

获取过程必须容错：

- `Intl.DateTimeFormat().resolvedOptions().timeZone` 抛错、为空或不可用时，页面不得崩溃。
- fallback 使用 `UTC`。
- UI 必须明确标示当前正在使用 UTC fallback，而不能让用户误以为这是检测到的浏览器时区。
- 浏览器时区不得写回 `locations.json` 或其他持久化地点数据。
- 不要永久缓存首次检测结果；页面重新加载、重新渲染或运行时检测到浏览器时区变化后，应按新时区更新结果。

### 4.2 明确禁止

生产逻辑不得：

- 默认使用 `Asia/Shanghai`；
- 默认使用中国时间或其他固定时区；
- 根据 zh-CN / en locale 决定时区；
- 根据地点国家或 `countryCode` 推断用户时区；
- 根据经度推断时区；
- 保存固定 UTC offset；
- 用简单的 `UTC ± N` 小时运算替代 IANA timezone 转换。

网站语言和浏览器 timezone 是两个完全独立的概念。

---

## 5. 页面顶部时间信息

页面顶部显示：

1. 页面标题。
2. 简短说明：
   - 地点按各自当地下一次周二 20:00 计算；
   - 结果自动转换成当前浏览器本地时间。
3. 浏览器当前时间。
4. 浏览器当前 IANA timezone；使用 fallback 时明确标示。
5. 数据点总数。
6. 当前筛选后的点数。

顶部时间和地点卡片中的“我的时间”必须使用同一个运行时 `browserTimeZone`。

---

## 6. 地点卡片

每张地点卡片按现有 UI 风格显示：

1. 国家旗帜。
2. 按当前网站 locale 本地化的国家名。
3. 原样显示的地点 `name`。
4. 类型 badge。
5. 状态 badge。
6. `needsReview`。
7. `rating`。
8. 经纬度。
9. 地点 IANA timezone。
10. 地点当前 UTC offset；运行时计算，不写入数据。
11. 地点当前当地日期与时间。
12. 下一次地点当地周二 20:00。
13. 同一 target instant 对应的浏览器本地日期、星期与时间。
14. 用户原始 `note`。
15. `Open Official Map`。
16. `Copy Coordinates`。

示例：浏览器当前位于 `America/Toronto` 时：

```text
当地现在
2026-08-18 周二 20:35

下一个当地周二 20:00
2026-08-25 周二 20:00

我的时间
2026-08-25 周二 09:00
```

同一份地点数据在香港、东京、伦敦或其他时区打开时，必须自动显示为相应浏览器时区，无需修改数据。

---

## 7. i18n 与 locale 切换

删除旧 key：

```text
spots.chinaTime
```

改用：

```text
spots.browserTime
```

全站统一采用一组术语，例如：

```text
zh-CN: 我的时间
en:    My Local Time
```

也可沿用现有 UI 风格使用“本机时间 / Device Time”，但同一站点内必须一致。

### 7.1 locale 切换后需要更新

- tab；
- toolbar；
- 国家显示名；
- 类型与状态；
- 日期、星期和时间格式；
- 字段标签；
- 按钮；
- empty / error / copy feedback。

### 7.2 locale 切换后保持原样

以下内容不翻译、不改写：

- `spot.name`；
- `spot.note`；
- coordinates。

地点 `name` 不得加入任何 i18n 文件。

示例：

```text
中文 UI：🇮🇳 印度 · 迈索尔 Mysuru
英文 UI：🇮🇳 India · 迈索尔 Mysuru
```

这里只有国家名称和 UI label 变化，`迈索尔 Mysuru` 始终不变。

---

## 8. 时区计算契约

对地点 timezone `zone` 和当前 instant `now`：

1. 将 `now` 投影到地点 IANA timezone，取得地点当地日期、星期和时间。
2. 按 `schedule.isoWeekday/hour/minute` 找到候选 wall-clock time。
3. 选择不早于 `now` 的下一次候选：
   - 当前 instant 恰好等于地点当地周二 20:00 时，该时刻仍是本次目标；
   - 晚 `1 ms` 后必须滚到下一周。
4. 使用地点 IANA timezone 将该 wall-clock time 正确转换成唯一 UTC instant。
5. 获取运行时 `browserTimeZone`，失败时按第 4.1 节回退到 UTC。
6. 将同一个 UTC instant 分别格式化为：
   - 地点自身 timezone；
   - 当前浏览器 timezone。

不得专门格式化为 `Asia/Shanghai`，除非用户浏览器本身检测结果恰好是该时区。

### 8.1 正确性要求

- 使用 IANA timezone 数据。
- 正确处理地点 timezone 的 DST。
- 正确处理浏览器 timezone 的 DST。
- 正确处理半小时及时区日期跨越。
- 不保存固定 offset。
- 不通过经度推断 timezone。
- 不通过网站语言决定 timezone。
- 不把浏览器 timezone 写入地点数据。

### 8.2 可测试 helper 边界

时区 helper 应允许显式传入展示时区，例如：

```text
nextLocalScheduleInstant(nowInstant, locationZone, schedule)
formatTargetForZone(targetInstant, displayZone, locale)
```

生产环境：

```js
displayZone = browserTimeZone;
```

测试环境显式传入固定 `displayZone`，确保结果 deterministic。不得让 helper 在测试中隐式依赖测试机的系统时区。

---

## 9. 固定时间测试

生产环境展示时区动态来自浏览器，测试不得假设最终展示时区永远是 `Asia/Shanghai`。至少覆盖两个固定 display zone。

### 9.1 Fixture A — `Asia/Shanghai`

各地点当地目标均为：

```text
2026-08-18 周二 20:00
```

预期转换结果：

```text
Asia/Kuala_Lumpur   → 2026-08-18 20:00 Asia/Shanghai
Asia/Bangkok        → 2026-08-18 21:00 Asia/Shanghai
Asia/Dhaka          → 2026-08-18 22:00 Asia/Shanghai
Asia/Kolkata        → 2026-08-18 22:30 Asia/Shanghai
Europe/Paris        → 2026-08-19 02:00 Asia/Shanghai
America/New_York    → 2026-08-19 08:00 Asia/Shanghai
America/Los_Angeles → 2026-08-19 11:00 Asia/Shanghai
```

`Asia/Shanghai` 在这里仅是显式测试 fixture，不是产品默认 timezone。

### 9.2 Fixture B — `America/Toronto`

至少以以下地点 timezone 的当地周二 20:00 为输入：

```text
Asia/Kolkata
Europe/Paris
America/Phoenix
America/Los_Angeles
```

显式传入：

```text
displayZone = America/Toronto
```

确认每个 target instant 都能正确格式化，并正确应用 Toronto 当时的 DST。对于 `2026-08-18`，可使用以下 deterministic 预期：

```text
Asia/Kolkata        → 2026-08-18 10:30 America/Toronto
Europe/Paris        → 2026-08-18 14:00 America/Toronto
America/Phoenix     → 2026-08-18 23:00 America/Toronto
America/Los_Angeles → 2026-08-18 23:00 America/Toronto
```

### 9.3 必测场景

- browser timezone 为 `Asia/Shanghai`。
- browser timezone 为 `America/Toronto`。
- browser timezone 为 `Europe/London`。
- 无法取得 browser timezone 时回退到 UTC，且返回/渲染明确的 fallback 状态。
- 当前 instant 恰好等于地点当地周二 20:00。
- 当前 instant 比当地周二 20:00 晚 `1 ms`，目标滚到下周。
- `Asia/Kolkata` 的半小时差不被取整。
- 欧洲时区在夏令时和冬令时的结果不同。
- 美洲时区在夏令时和冬令时的结果不同。
- 浏览器展示时区自身的 DST 会改变显示结果，而 target instant 保持不变。
- locale 切换只改变格式和 UI 文案，不改变 `spot.name`。

---

## 10. Validation 修改

### 10.1 删除旧验证

不再验证或要求：

```text
nameZh
nameEn
schedule.displayTimeZone
```

### 10.2 新验证

`schedule` 验证：

- `isoWeekday` 存在，且为 `1` 至 `7` 的整数；
- `hour` 存在，且为 `0` 至 `23` 的整数；
- `minute` 存在，且为 `0` 至 `59` 的整数；
- 不要求也不允许依赖 `displayTimeZone`。

每个 spot 验证：

- `name` 存在；
- `name` 的类型为 string；
- `name.trim()` 非空；
- 不存在 `nameZh` 或 `nameEn`；
- `timeZone` 继续按有效 IANA timezone 验证；
- 其他未被本修订变更的 schema 约束保持不变。

### 10.3 禁止持久化动态字段

spot 条目不得出现：

```text
flag
utcOffset
browserTime
displayTime
chinaTime
nextTuesday
mapUrl
```

这些值如 UI 需要，必须在运行时派生。

---

## 11. Preflight 修改

删除旧检查：

```text
displayTimeZone 可以被运行时识别
nameZh/nameEn 不为空
```

改为检查：

```text
每个 spot 的 name 不为空
每个 spot 的 timeZone 是有效 IANA timezone
浏览器展示 timezone 在运行时动态获得，并有 UTC fallback
```

Preflight 不得要求 `Asia/Shanghai` 存在于 `locations.json`，也不得要求任何固定展示时区。

---

## 12. 完成标准

全部满足才算完成：

- `locations.json` 每个地点只有一个 `name`。
- 不存在 `nameZh` / `nameEn`。
- 不存在固定 `displayTimeZone`。
- `locations.json` 不含任何禁止持久化的动态字段。
- 下一次地点当地周二 20:00 能正确转换为 UTC instant。
- 当前 instant 恰好等于目标时刻时仍选择本次；晚 `1 ms` 后选择下周。
- 同一个 target instant 按当前浏览器 timezone 动态显示。
- 浏览器在不同时区打开页面时，无需修改任何地点数据。
- 地点和浏览器两端的 DST 都被正确处理。
- 半小时时区不被取整。
- browser timezone 获取失败时页面不崩溃，使用 UTC 并明确显示 fallback。
- 网站 locale 切换不会改变地点名称、note 或 coordinates。
- `spots.browserTime` 已替代 `spots.chinaTime`，且全站术语一致。
- validation / preflight 对新 schema 正确检查。
- 固定 display-zone 测试、边界测试、DST 测试及 fallback 测试全部通过。

以上要求优先于旧任务书中所有关于 `nameZh`、`nameEn`、`Asia/Shanghai`、`中国时间`、`chinaTime` 和 `displayTimeZone` 的旧要求。
