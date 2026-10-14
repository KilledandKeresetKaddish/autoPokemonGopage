# AGENTS.md — pogo-agent daily operator guide

This repository is a **self-contained Pokémon GO dashboard**. One non-interactive Pi
runs per scheduled invocation (typically daily, configured externally via cron) through
`scripts/run-daily.sh` with this directory as its working directory. Each run you
refresh the site's content from trustworthy
sources and write it into the files listed under **"What you may edit"**. The wrapper
then runs `scripts/validate.sh` and either publishes your changes (git commit) or
saves a pending draft before rolling the working tree back.

You are the **brain**. The deterministic scripts only download bytes — *you* decide
what to fetch, whether it's even needed today, and how to interpret it. Third-party
formats change: inspect new/changed bytes and adapt their extraction; never assume fixed field
positions. Already-processed identical bytes may reuse their interpretation (see “Reuse and detail review”).

The dashboard is bilingual. Canonical content (`events.json`, `rotations.json`,
`categories.json`, `mega.json` and the five `index.html` AI wrappers) must be
**Simplified Chinese (简体中文)**; the text-only overlay
`public/data/i18n/en.json` must be **English-only**. Both editions describe one
shared set of IDs/dates/links/sprites and publish atomically. Spot Atlas is separate:
`locations.json` keeps one operator-supplied `name` and `note` verbatim (Chinese, English or mixed)
for both locales and never duplicates them into the English overlay.

**Single-Pi execution.** All six responsibility briefs belong to you, the one current
Pi, and must be completed in their numbered order. Never delegate or spawn work through
a tool, Bash command, API, extension, or another coding-agent CLI; there are no child
agents or parallel workstreams in a daily run. The wrapper embeds this core
file, `tasks/daily-update.md`, and all six briefs exactly once. Detailed schemas
and HTML examples in `tasks/reference/daily-schemas.md` are read only when
relevant. Do not re-read embedded text just
to load them again; only after genuine context compaction may you re-read the specific
passage that was actually lost.

**Recovered-draft source baseline.** On a normal run, the current committed
`data/state.json` is the last-successful source baseline. If a `RECOVERED DRAFT` block
is present, the workspace copy is unfinished draft output: use the block's committed
base state (`git show <base-head>:data/state.json`) for Source Scout hash/timestamp
comparisons. Never declare a quiet day from draft state; still run freshness,
discovery, and date maintenance, then correct or reuse draft content as sources warrant.

**You have full network access — use it, never refuse.** You reach the internet **only**
through `scripts/fetch.sh` and `scripts/discover.sh` (plain Bash commands). You do **not** have
a model-hosted browser or `web_search` tool — so don't wait for one, and **never tell the
operator you "have no internet / network / search access."** That is false: those two scripts
*are* your access, and on this host they run without a sandbox. Whenever a request needs anything
you can't already confirm from the cache in `data/raw/*` — a link, a date, a bonus, a spawn, a
shiny, a counter, a Pokémon/move name — **go get it yourself, before you edit or reply**, in this
order:
1. **Find the URL if not already known/verified** — `scripts/discover.sh "<english keywords>"` returns candidate URLs on the
   trusted sources. (This is the step `fetch.sh` can't do: `fetch.sh` only downloads URLs you
   already know; `discover.sh` *finds* them.)
2. **Open & read it** — use the URL-cache modes under “Reuse and detail review”
   (or the relevant named bulk source); later responsibilities reuse this successful read.
3. **Then edit**, using only what you actually read. **Never guess or hand-build a URL, and never
   leave a placeholder that blames missing access** — discover, fetch, verify, or omit.

## Name verification (shared by all responsibilities)

Never write a Pokémon species/move name from memory. `gamemaster.json` verifies dex,
English identifiers, types and moves as stable facts; it is **not a 简体中文 name source**.
Use `scripts/fetch.sh zh <dexId>` for species and `scripts/fetch.sh zh move:<slug>` for
moves, using the returned zh-Hans verbatim. If lookup fails or returns `NO-ZH-NAME`,
omit the name or retain the verified source English/romanized proper name. This is an
explicit exception to canonical Chinese-only prose, not permission to leave English
headlines or invent translations. English proper names use the real source or lookup,
never literal translation. All Chinese-only rules/checklists below inherit this exception.

**How to verify in practice.** `gamemaster.json` contains English species names; it does
**not** contain 简体中文. To produce a verified 简体中文 name: (1) identify the national-dex id
from the source data or `gamemaster.json`; (2) run **`scripts/fetch.sh zh <dexId>`** (species)
or **`scripts/fetch.sh zh move:<move-slug>`** (moves) — it answers one TSV line
(`key  en  zh-Hans`) from the permanent local dictionary `data/raw/zh-names.json`, hitting
PokeAPI only the first time a key is seen (names never change); (3) use that Chinese name
verbatim. Do **NOT** `fetch.sh url https://pokeapi.co/api/v2/pokemon-species/…` just to check
a name — that dumps 50–100KB of flavor text for one line of signal (the raw species/form URLs
remain for *form* research: form ids, sprites). If the lookup prints `NO-ZH-NAME`, keep the
English/romanized form — do **not** translate from memory. Common game vocabulary (属性 names
like 火/水/草, item names like 星尘/糖果, mechanic terms) is **not** covered by this rule —
only species and move names. The same lookup also verifies the English edition:
column 2 is the source/PokeAPI English name and column 3 is `zh-Hans`; English Curator
must use column 2 (or an exact live-source spelling), never literal-translate a proper
Pokémon/move/form name.

**`gamemaster` is authoritative for *stable facts* only — NOT for what *exists this season*.**
Use it to confirm a dex→species mapping, a Pokémon's 属性, or a move→type (the counter type-icons).
Do **NOT** use it to decide whether a **Mega / Primal / regional / brand-new form exists or is
featured** — the Mega roster keeps growing with new game content (e.g. Legends Z-A), so a cached
PvPoke snapshot lags and will wrongly report a real new Mega as "nonexistent". A Pokémon being
absent from gamemaster's mega list is **not** evidence it has no Mega. Confirm any Mega/form (and
any brand-new species) against a **live** source — the LeekDuck/Hub event page, 官方 news, or
PokeAPI — never the cache. In particular, when a source names an event "<X> **Super Mega** Raid
Day", treat <X>'s Mega as real and render the Mega form, even if gamemaster lacks it.

---

## The site (calendar/rankings + owner tools)
1. **Calendar** (`#view-calendar`) — month grid **+ a 长期活动 band + a PVP活动 band** (events
   pulled out of the grid) **+ a 本月 Weekly Rotations** section. Data-driven from
   `public/data/events.json` and `public/data/rotations.json`: short headline events live in
   the grid; season/pass/multi-week events render in the 长期活动 band; PVP events (对战联盟 /
   杯赛 / 对战周末) render in the PVP活动 band; the 5★/Mega/Max weekly boss rotation renders
   from `rotations.json`.
2. **Rankings** (`#view-rankings`) — Max attackers / Max defenders / raid counters, plus
   a "本期推荐" panel tied to what's live right now.
3. **Spot Atlas** (`#view-spots`) — a bilingual, data-driven location atlas loaded from
   `public/data/locations.json`. Each spot targets its own next local Tuesday 20:00 and the
   browser converts that instant to its dynamically detected local IANA timezone.
A header language button switches owner UI, canonical event/rotation text and the five rich
regions between 简体中文 and English without duplicating structural facts. Spot `name`, `note`
and coordinates are canonical raw values and **never change with locale**.
The **世界时钟** (`#view-clock`), **多账号 TODO** (`#view-todo`) and **实用链接**
(`#view-links`) shells are owner-maintained (no AI markers). Do not edit their HTML/app logic.
`locations.json` is the sole exception described below: maintain its data only on an explicit
admin/operator request.

## What you MAY edit — and nothing else
> **This whitelist (and the HARD RULES below) bind _you, the daily content-update agent_.** They keep an
> automated daily run from altering the program itself — not a blanket ban on the files. A coding /
> maintainer agent doing deliberate development on the app (see `CLAUDE.md`) edits `app.js`, `style.css`,
> `scripts/*`, and `index.html` as its job, and is **not** bound by this list. The boundary is by _role_
> (automated daily refresh vs. deliberate code change), not by file.
- `public/data/events.json` — the normalized events array the calendar + 长期活动 band render.
- `public/data/rotations.json` — the current month's 5★/Mega/Max weekly boss rotation.
- `public/data/categories.json` — register a NEW event `type` (palette key + 简体中文 label + kind)
  when a source introduces one the built-ins don't cover. **Palette KEY only — never a raw colour.**
- `public/data/meta.json` — set `lastUpdated` (ISO 8601); the header shows it.
- `public/data/locations.json` — Spot Atlas stable location records. **Edit only when the
  admin/operator explicitly asks to add, remove or change a location**; never refresh or
  rewrite it autonomously from event sources. Preserve the top-level schedule and the single
  canonical `name` field rules under the Spot Atlas schema in `tasks/reference/daily-schemas.md`.
- `public/data/i18n/en.json` — English **text-only overlay**, owned only by English
  Curator (40). It mirrors canonical event IDs and nested-array order, rotation track/
  segment order, custom category keys and all five rich regions; it never contains
  dates, dex IDs, URLs, sprites, flags, booleans or other structural facts.
- The Simplified-Chinese AI regions inside `public/index.html`, **strictly between**
  these marker pairs. Each pair contains one required
  `<div data-ai-region="<region-name>">…</div>`; preserve the wrapper and replace only
  its inner HTML:
  - `<!-- AI:START calendar-notes -->` … `<!-- AI:END calendar-notes -->`
  - `<!-- AI:START rankings-current -->` … `<!-- AI:END rankings-current -->`
  - `<!-- AI:START rankings-attackers -->` … `<!-- AI:END rankings-attackers -->`
  - `<!-- AI:START rankings-defenders -->` … `<!-- AI:END rankings-defenders -->`
  - `<!-- AI:START rankings-raid -->` … `<!-- AI:END rankings-raid -->`
- `public/data/featured.json` — admin-curated list of event `id`s to feature (gold border on the
  calendar). **You maintain this file on behalf of the admin**: when the admin tells you to feature
  or unfeature an event, add or remove that event's `id` from the array. Format: `["event-id-1", "event-id-2"]`.
  Do NOT add IDs on your own initiative — only when the admin explicitly requests it. Prune IDs
  whose events have been removed from `events.json`.
- `data/state.json` — your own bookkeeping (last-fetch times, source hashes, notes).
- `public/data/mega.json` — the cumulative **超级进化 / 原始回归 roster** shown in the 「超级进化」view.
  On a newly announced Mega/Primal, add one unique row. Existing rows may be surgically
  completed or corrected from actually verified sources: e.g. `initialCost:null` → a
  confirmed supported value, or `superMax` after official announcement. Keep identity
  (`en`, base dex, variant) stable; do not create duplicates, delete old records without
  evidence, or rewrite unrelated rows. New values must obey the existing schema and
  supported mechanics: an unsupported case is a developer note, never grounds to relax
  a gate. Daily may not change `app.js` mechanics tables or calculate mechanics numbers.
  Every cost/time number the view shows (per-level energy costs, generic bonuses, instant level-up
  prices, the 升级规划器 comparisons) is DERIVED from the single field `initialCost` via mechanics
  tables baked into `app.js`; the only other mechanics-relevant field is the optional `superMax`
  flag below. You **never** compute or edit those numbers, and you never touch `app.js`/the
  `#view-mega` HTML.
  Row schema (flat array; reuses the usual sprite/link conventions):
  ```json
  { "id": 3, "name": "超级妙蛙花", "en": "Mega Venusaur",
    "boostedTypes": ["grass","poison"], "initialCost": 200, "release": "2020-08-27",
    "sprite": "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/10033.png",
    "hub": "3-Mega" }
  ```
  - `id` = **base national-dex id** (X/Y & Primal share it → identity is the **unique `en`**; validation
    rejects duplicate `en`). `variant` (`"X"`/`"Y"`) and `kind` (`"primal"`) are optional display labels.
  - `name` = 简体中文 (verify via PokeAPI `zh-Hans` as usual — never from memory), prefix `超级`/`原始`.
  - `boostedTypes` = **type KEYS only** (`fire`,`water`,… the 18 keys in the 属性→图标 map), never 中文.
    These are the **candy-boost 加成属性, NOT the form's own typing**. For ordinary Megas the two happen
    to coincide (e.g. Mega Skarmory → `steel`,`flying`), but three weather-linked forms boost a fixed
    trio — do **NOT** "correct" them back to the form typing:
    | Form | boostedTypes |
    |---|---|
    | Primal Kyogre | `water`,`electric`,`bug` (rain group) |
    | Primal Groudon | `fire`,`grass`,`ground` (sun group) |
    | Mega Rayquaza | `flying`,`dragon`,`psychic` (wind group) |
  - `initialCost` = the first-time Mega Energy cost. **Must be one of `{100,200,300,400,7500}` — or `null`
    if TBD/pre-release** (the view then shows「待定」). Do **NOT** invent a value; leave `null` until confirmed.
  - `superMax` (optional boolean) = this form can reach the **超级最高 (Super Max)** level. Set `true`
    **only when officially announced** for that form (as of 2026-07 exactly seven: Victreebel, Dragonite,
    Skarmory, Malamar, Falinks, Mewtwo X/Y). Omit the field otherwise — never guess. The view's planner
    hides the Super-Max target row for forms without it.
  - `sprite` (Mega/Primal form image — required, base dex sprite can't show the form) + `hub` (form slug
    e.g. `6-Mega_X`, `382-Primal`) follow the same conventions as `rotations.json` mega segments.
    **Both are enforced by `validate.sh`** (sprite must be an `https://` URL, hub non-empty): without them
    the view falls back to the base Pokémon's art and links the base Hub page — wrong for every Mega.
    If no form image exists yet, use the Hub DB pattern `…/images/official/full/<3-digit dex>_mega[_x|_y]/_primal_with_bg.webp`
    and confirm it **exists** via `scripts/fetch.sh url <该图片URL>` — image URLs get a HEAD check
    (expect `HTTP/… 200` + `content-type: image/…`); do not append the row without a confirmed sprite.
  - **Sourcing:** Bulbapedia's Mega tables are the human reference but are **off-allowlist and 403 to
    automated fetch** — take roster/cost from the admin (screenshots) or corroborate via allowlisted
    Fandom/官方 sources; never fabricate.
  - This roster is a **cumulative reference**, independent of the weekly `rotations.json` mega track —
    they need not match (one is "ever existed", the other is "live this week").

## HARD RULES (validation rejects the run if broken)
- **NEVER** edit `.gitignore`, `public/app.js`, `public/style.css`,
  `public/data/i18n/ui.json`, `scripts/*`, `AGENTS.md`, `tasks/*.md`, `CLAUDE.md`, or anything in
  `public/index.html` **outside** the AI markers. Keep every `AI:START`/`AI:END` marker
  present and balanced, preserve each required `data-ai-region` wrapper, and keep the
  `.rank-panel` wrappers and all `id="…"` attributes intact. (Enforced:
  `validate.sh` hash-checks the protected files against
  `scripts/protected.sha256`, and `run-daily.sh` git-reverts any change under `scripts/`, `tasks/`,
  `AGENTS.md`, `CLAUDE.md` and fails the gate; `index.html` structure is checked via required
  tokens + markers.)
- The HTML you write must be **inert**: no `<script>`, no `<style>`, no `<iframe>`/`<object>`/`<embed>`,
  no event-handler attributes (`onerror`, `onload`, `onclick`, …), no `javascript:` URIs, no external CSS/JS.
- Keep `public/data/*.json` and `public/data/i18n/*.json` valid JSON per `tasks/reference/daily-schemas.md`.
  English overlay IDs/track keys and every localized nested-array length/order must
  exactly match canonical data; English rich HTML follows the same inert-HTML rules
  and `en.json` must contain no CJK fallback text.
- **Fetch only via `scripts/fetch.sh` / `scripts/discover.sh`**: the named sources below, ad-hoc
  detail pages on the allowlisted domains via `scripts/fetch.sh url <URL>`, and candidate-URL
  search via `scripts/discover.sh "<keywords>"` (see *Looking things up*). Never fetch
  off-allowlist domains.

---

## 渲染契约 — 改 `events.json` / `rotations.json` 前必读
日历的两种"标记"由**不同文件**驱动,**选错文件 = 看不到效果**。这是硬约定,
`scripts/preflight.sh` 会据此在发布前拦截(orphan / 不一致 / form-id;**超长 chip 只 WARN、
不拦截** —— chip 名称请自行控制在 ≤14 字)。

- **日期数字旁的小角标 = 由 `rotations.json` 的轨(track)产生**,覆盖到的每一天画一个。`events.json` 里的
  事件**永远变不成角标** —— 它们只会是横跨日的 **bar** 或格子里的 **chip**。所以"给某些天加 Boss 角标"
  (包括 传奇之路 这类多日活动)= 往 `rotations.json` 加**单日段**,**不是**往 `events.json` 塞 `raid-hour` chip。
- **角标轨是"默认全显示"的(opt-out)**:`app.js` 现在渲染 `rotations.json` 里**每一条**带 `pokemon` 的轨,
  不再写死只认 `5star`/`mega`。`5star`(金环 5★)、`mega`(紫环 M)、`max`(粉环 MX,极巨团战)有内置配色/字形/图例文案;
  **游戏将来新增的团战档次也会自动出现在格子里** —— 新轨用一个新 `key` + `color` + **≤2 字符的 `tag`**(角标只显示 2 字)
  即可,无需改代码。某条轨不想进日历格子(例如纯统计轨)时,给它设 `"showOnCalendar": false`。
- **有角标的月份,`app.js` 会隐藏所有 `raid-battles` 的 bar**(改由角标代表)。因此每个 `raid-battles`
  事件**必须**有一个 **dex id + 日期都匹配**的 `rotations.json` 段,点角标才能经 `findRaidEvent` 打开它的
  抽屉;否则它**既无 bar 又无角标 = 静默消失**(preflight 报 `orphan raid`)。例外:`longTerm:true` 进
  长期 band,不受此限。
- **角标 ↔ 抽屉必须一致**:`renderRotations()` **逐字**渲染 `seg.pokemon`。单日段的 `pokemon[]` 应直接等于
  当天对应 `raid-battles` 事件的 `pokemon[]`(5★ 段 = 事件里非超级/原始的 Boss;超级段 = 当天的超级/原始)。
  段里出现抽屉没有的 Boss、或抽屉里的 Boss 在任何角标都不出现,都会被 preflight 拦下。角标本身只显示前 3 只
  (多只会循环);rotation 面板显示前 4 只精灵并以 `+N` 汇总(完整名单在悬停提示),而 preflight 按**完整**
  `seg.pokemon` 核对角标↔抽屉一致 —— 所以**别只放 3 只"代表"**,要放全;池子太大时
  用段名 `cn` 标注"多种轮替"。
- **Mega/形态段用 BASE 全国图鉴 id**(= 该 Boss 在 `events.json` 里用的 id)+ `"sprite"` 形态图覆盖。用
  form id(≥10000)会让角标匹配不到事件、打开空抽屉(preflight 报 `mega base-id`)。形态精灵图优先用可核验的
  PokeAPI 形态 id(`raw.githubusercontent.com/PokeAPI/sprites/.../<formId>.png`),写前可 `fetch.sh url` 确认
  (图片 URL 走 HEAD 检查,回显 HTTP 状态与 Content-Type,2xx + `image/*` 即存在)。
- **多日"每日轮换"事件 playbook(传奇之路 / GO Fest 前置周等)**:
  ① 主活动在 `events.json` 出**一条横幅事件**(`event`/`pokemon-go-fest`,跨度大可 `longTerm:true`)。
  ② 当天每个 Boss 在 `events.json` 出**全天 `raid-battles` 事件**(承载 counters/links/summary 抽屉)。
  ③ 在 `rotations.json` 的 `5star`/`mega` 轨为这几天各加**单日段**(`start==end`),`pokemon[]` 取自 ②。
  ④ 角标自动生成、点开即 ② 的抽屉。**不要**用 `raid-hour` chip 模拟每日 Boss。

> 自检:跑 `scripts/preflight.sh`(`run-daily.sh` 已在 `validate.sh` 前**强制**运行,任一不过即回滚)。
> 它模拟 `app.js` 的日历逻辑,`validate.sh` 只看结构、看不到这些语义问题。

---

## Data sources — fetch via `scripts/fetch.sh <name>`
Start by running `scripts/fetch.sh list` and reading the applicable last-successful
state baseline described above (normally the committed workspace `data/state.json`;
for a recovered draft, the `RECOVERED DRAFT` base state). **Decide what to refresh by
age — do not blindly refetch everything.** `list` prints each cache's sha256 (16 hex) —
compare the final prepared caches against the `sha256` recorded per source in that baseline.
Identical **successfully processed** bytes may reuse their interpretation, but list hashes
say nothing about a detail page or the current date. Apply “Reuse and detail review” below,
then read changed sections (grep/jq, not big-file dumps). Raw caches and draft state are
source materials/unfinished output, never evidence of successful processing.

| source | what | refresh when | output |
|---|---|---|---|
| `events` | events/community days/spotlights (ScrapedDuck → LeekDuck) | older than ~1 day | `data/raw/events.json` |
| `raids` | current raid bosses | older than ~1 day | `data/raw/raids.json` |
| `eggs` / `research` | egg pools / field research | when relevant | `data/raw/*.json` |
| `gamemaster` | Pokémon stats, types, moves (PvPoke) | older than ~7 days | `data/raw/gamemaster.json` |
| `tiers-attackers` | Hub "Max Attackers Tier List" page (**含属性榜**, per-type picks) | older than ~3 days | `data/raw/tiers-attackers.txt` |
| `tiers-defenders` | Hub "Max Defenders Tier List" page | older than ~3 days | `data/raw/tiers-defenders.txt` |
| `tiers-pokebase` | pokébase tier lists (cross-check / second opinion) | older than ~3 days | `data/raw/tiers-pokebase.txt` |
| `events-hub` | Hub events **index** (`/post/event/` — it *links to* the monthly roundup article but does **not** contain its body; find the article URL in it and open it via `fetch.sh url`) | older than ~1 day | `data/raw/events-hub.txt` |
| `events-pokebase` | pokébase events list | older than ~1 day | `data/raw/events-pokebase.txt` |
| `events-official` | pokemongo.com official news/events | older than ~1 day | `data/raw/events-official.txt` |

> The Hub tier/event pages, pokébase, and the official site sit behind a Cloudflare
> challenge or heavy JS, so `fetch.sh` pulls them through a solver (Jina Reader by
> default) — the saved `.txt` is the rendered page content (markdown or HTML). Parse
> new/changed bytes in their actual format; reuse verified extraction only for identical
> successfully processed bytes. If parsing fails, retain last good content and report the gap.
>
> **Source priority — multi-source, never LeekDuck-only.** Treat **Hub + 官网 (pokemongo.com) +
> LeekDuck** as **co-equal primary** sources for deciding *what exists this period*; pokébase /
> Fandom / Serebii corroborate. `events` (ScrapedDuck → LeekDuck, clean JSON) stays the convenient
> **structured backbone** for *normalizing* the events you include — but it is **not** the sole
> arbiter of whether an event is real. **Never conclude an event "doesn't exist" — and never skip it —
> just because LeekDuck 404s or omits it.** Region- or country-limited events
> routinely live on Hub's monthly roundup, the 官网 news, or `pokemongo.fandom.com` even when LeekDuck
> has no page. **Before dropping any event as nonexistent, sweep the sources you can actually search or bulk-read** —
> the LeekDuck feed, the `events-hub` / `events-official` / `events-pokebase` bulk files **and** their
> monthly articles, plus `scripts/discover.sh "<keywords>"`, which now searches **LeekDuck + Hub + 官网 +
> Pokémon GO Wiki (Fandom)** for you — then open each lead with `scripts/fetch.sh url <URL>`. Only call it
> nonexistent after that sweep is empty. `serebii.net` has **no** search or bulk feed, so it **cannot** be
> swept: consult it only as corroboration when you already hold a specific URL, and never read "absent
> from Serebii" as evidence either way.
> If a Jina source is flaky or empty, still build a complete calendar from whatever primaries you
> *can* read. **Iron rule, unchanged: only ever use real, reachable URLs you have actually fetched —
> never invent, hand-build, or guess a link; record a genuinely-unconfirmable event as a gap in
> `data/state.json` rather than fabricating a source.**

**Sprites** need no fetch — build image URLs directly from a Pokémon's national-dex id:
`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/<dexId>.png`
If PokeAPI has no usable sprite for a form, fall back to a **Pokémon GO Hub DB** image (allowlisted) via
the `"sprite"` override: `https://db.pokemongohub.net/images/official/full/<dexId>_<form>_with_bg.webp`
(e.g. `015_mega_with_bg.webp`, `150_mega_y_with_bg.webp`).

> If a fetch fails or a page comes back empty/unparyable (a source changed, or Hub is
> unreachable), **keep the last good content in place**, record the problem in
> `data/state.json`, and still pass validation. Never ship empty rankings.

### Token discipline (cost control — as binding as the content rules)
Every byte you read or write passes through the model. The verification density above is
deliberate; paying for it wastefully is not. Four rules:
1. **Never read a big cache wholesale.** `gamemaster.json` is ~900KB **minified onto a single
   line** — reading it dumps the entire file into your context. Extract entries instead, e.g.
   `jq '.pokemon[] | select(.dex==212)' data/raw/gamemaster.json` ·
   `jq '.moves[] | select(.moveId=="IRON_HEAD")' data/raw/gamemaster.json` (adapt to the file's
   current structure, as always). Same for `tiers-pokebase.txt` (~120KB) and other large caches:
   `grep`/`sed` the sections you need — never cat the whole file.
2. **Name checks via `scripts/fetch.sh zh`**, never a raw species-URL dump (see *How to verify
   in practice* above). One TSV line out, cached forever in `data/raw/zh-names.json`.
3. **Edit `public/data/events.json` in place.** Never regenerate/rewrite the whole file when a
   handful of events changed: a full re-emit of ~170KB re-pays every byte as output tokens AND
   risks transcription drift in the untouched 90%. Add / update / delete just the affected rows
   (same for `rotations.json` and the ranking regions).
4. **Reuse already-verified URLs and terminology.** A trusted unchanged link needs no
   rediscovery. Its **body** can still need rechecking by the policy below. Use cached
   paths and bounded extraction; later responsibilities reuse this run's successful read.

### Reuse and detail review

**Prepare → discover → compare.** Source Scout checks cache times with `fetch.sh list`,
refreshes stale/relevant named sources by the table above, then runs
`scripts/discover.sh new --cached --json`. That mode makes **zero** requests and validates
fresh (<24h), minimally usable `events`/Hub/official caches before reporting. Its version-1
JSON has `status` (`complete` / `partial` / `failed`), per-source availability/coverage,
`candidates`, `pendingDate`, `exceptions` and `gaps`; legacy TSV remains for human use.
Exit **0** means complete coverage, **1** means partial coverage but stdout still contains
usable leads, and **2** means failed/usage. Capture/read the JSON even on exit 1; never let
a nonzero shell status discard valid rows. Only `status:"complete"` with `completeNoNew:true`
means “no new”; missing, stale, malformed or date-TBD source material is never quiet-day
proof. Date-TBD leads require verification, not invented dates. Hub/official URL leads are
independent candidates: compare exact URL/event identity/period+date, not fuzzy calendar text.
Independent `discover.sh new` retains its default refresh. Compare hashes against committed
state **after** the final discovery inputs are settled; do not implicitly refresh those feeds
afterward. Cache time proves only material freshness, not completion.

**URL body cache** (allowlist and TIER_METHOD unchanged; image URLs still use HEAD):
- `fetch.sh url <URL...>` or `url --force <URL...>`: download and print the body.
- `fetch.sh url --max-age 86400 <URL...>`: reuse a valid body younger than 24h;
  otherwise refresh. Query strings remain distinct; no title-based keys/normalization.
- Add `--meta` to a download/reuse call when only its validated JSON metadata/path is wanted
  (no long body on stdout); `--info` remains no-network metadata-only inspection.
- `fetch.sh url --cached <URL...>`: explicit no-network last-good read; warns when ≥24h
  old. Cached/info modes reject images.
- Success stores an immutable body and atomically replaces its metadata pointer under
  `data/raw/details/`, keyed by SHA-256 of the exact URL. Named JSON/text caches likewise
  validate minimum source shape plus blank/challenge/solver-error bodies before atomic
  replacement. Failed/empty downloads return nonzero, print no stale body and do not advance
  successful time/hash or overwrite last good content.
- The wrapper supplies one `POGO_RUN_ID`; `FETCH_RUN_ID`/`DISCOVER_RUN_ID` may be supplied
  for standalone work. They reuse a successful exact-URL force/search result or same-run
  failure only for that run; a later run retries normally. `FETCH_METRICS_FILE` is optional
  JSONL observability only. Downloaded, minimally accepted, and State+Validator-processed
  detail bodies remain three separate facts; fetch never advances `state.details`.

**Detail triggers independent of list hashes.** Check all referenced detail URLs for:
1. New events or changed source entries (inspect only changed lists to identify affected IDs).
2. Active events and events starting within the next **7 calendar days**, inclusive.
3. Unended events with pending/TBD research, rewards, bonuses or other incomplete facts,
   even when farther away. Identify these explicitly; a prose marker is only a hint.
4. Operator-note verify/enrich/fix-link/force-recheck requests: **force refresh bypasses
   ordinary TTL**, even for past/far-future events. Discover missing URLs, not known ones.
5. The current month's rotation article: check its **body** every 24h, not its Hub index hash.

Ordinary candidates use 24h URL reuse; new/changed event content is inspected even if
its body is still fresh. Force each requested URL once, then reuse that successful
result across every referencing event and Calendar → Rotations → Rankings → English.
Group shared URLs before downloading; a changed shared page requires checking **all**
referencing events. Far-future, complete, unchanged events need no daily link sweep;
review when they enter the window. Ended events keep history/retention without daily
search/refetch (explicit corrections remain possible). Coverage still includes current
month through next month and region/country/in-person events from every primary.

**Read-only candidate aid:** `node scripts/daily-candidates.js --base-ref HEAD` emits
URL reasons/actions and date checks without network/writes. On recovery pass the block's
committed base ref, not draft state. Add repeatable `--changed <event-id>` for affected
source entries, `--pending <event-id>` for known incomplete facts, `--force <event-id>`
for operator rechecks, and `--monthly-url <verified-URL>`. `--now <ISO>` is for fixed-time
checks. Scout supplies these IDs/URLs from actual source/note interpretation; this is
candidate screening, not an authoritative completeness check or a content writer.
Re-run after a successful refresh to see `cachedHash` vs `processedHash`; a changed body
must enter downstream review even when every list hash is identical. Do not treat a
`reuse` action as “already processed”. Missing records are not completion evidence.

**Small processed-detail map:** State + Validator alone maintains
`data/state.json.details[originalURL] = {sha256, checkedAt, pending}` (full body hash,
UTC time it was actually interpreted into finalized canonical + English content, boolean
for known incomplete facts). Advance only after all affected retained content was handled
successfully; preserve the old record on failure. A fresh cache from a failed run can be
reused, but compare it with this **committed** map, not its own metadata or a draft map.
Prune records no longer referenced by retained events, current rotation/tier/raid regions
or the current monthly source. No unbounded log; raw cache entries are not task markers.

### Quiet-day and date advancement

Quiet-day skips **unchanged derivation**, not the sequence or date maintenance. Every
run compares finalized candidates with the last successful committed content/time:
- Month rollover: check `rotations.month`, obtain the confirmed new monthly body, and
  update only confirmed month content; do not relabel old bosses or invent missing dates.
- Compare active events, live Boss/Max sets (including scheduled rotation changes), and
  the current/next-7-day recommendation window. Retire ended recommendations and include
  just-started events even if source hashes are unchanged. The candidate aid flags these
  differences; also inspect time-of-day boundaries and actual recommendation text.
  **Event timing contract:** every event has `timing` (see `docs/event-timing.md` and
  `tasks/reference/daily-schemas.md`). `scope` (`global`/`regional`/`unknown`) is independent
  of `mode` (`local` wall clock/`absolute` unique instant/`unknown`). Verify each start/end
  separately as `exact`/`date`/`unknown` from its own source; numeric UTC offsets/old midnight
  placeholders alone do not establish scope or precision. Regional local needs a confirmed
  single-venue IANA `timeZone`; do not infer it from a city, longitude or viewer locale.
  Do not convert date-only/TBD to midnight for reminders. Use `resolveEventTiming(event, now,
  viewerTimeZone)` for known instant hints, but never equate the UTC date cutoff for 90-day
  canonical retention with personal reminder expiry. Global local end must allow the last
  UTC−12 zone (not UTC−11). `daily-candidates.js` reports conservative date hints for
  incomplete timing and `uncertainTimingIds`; check the source before claiming live status.
- Only affected `rankings-raid`, `rankings-current`, `calendar-notes` and corresponding
  English regions change. Static attacker/defender panels whose inputs are unchanged stay.
- Prune events ended >90 days ago, stale featured IDs, English entries and dangling
  `data-event-id` references in both locales. Retain last-month history until this cutoff.
- If source/detail/date content and the operator note trigger no change, leave calendar,
  rotations and English bytes unchanged. State/meta still update in responsibility 90.

Use the existing date-prefix convention (preflight/retention) with the run's UTC date
for screening; honor source event-local timestamps in content. The helper is day-granular:
UTC date and an event's local day/time can differ, so it cannot certify global live status
or catch intraday boundaries. Inspect those against verified source times; do not invent
IANA zones/offsets or change event time semantics. No global timezone scheduler is implied.

### Looking things up (ad-hoc, allowlisted)
The named sources above are the backbone. When you need a **specific detail page** the bulk feeds
don't cover — an individual LeekDuck event, a Hub article, a pokébase Pokémon/event page, an
official news post — pull it on demand and read it:
```
scripts/fetch.sh url https://leekduck.com/events/<slug>/
scripts/fetch.sh url https://pokemongohub.net/post/<...>
```
It prints the page to stdout (JS/Cloudflare hosts go through the solver; raw file/API hosts via
plain curl). **Allowed hosts:** `leekduck.com · pokemongohub.net · db.pokemongohub.net · pokebase.app ·
pokemongo.com · dialgadex.com · raw.githubusercontent.com · pvpoke.com · pokeapi.co · serebii.net ·
pokemongo.fandom.com` (`dialgadex.com` for best-attacker-by-type cross-checks; `db.pokemongohub.net`
for per-Pokémon movesets / counters / form images; **`serebii.net/pokemongo` + `pokemongo.fandom.com`
(GO Hub Wiki) for cross-checking Mega rosters / counters / 属性 / 弱点 when giving 建议 — extra
corroboration sources, never the sole basis**). Off-allowlist URLs are refused. Stay
**primarily on the named sources** — use `url` to enrich / corroborate / chase a detail, not to crawl.

**Don't know the URL? Discover it — don't guess.** The feeds give every LeekDuck link and the Hub
*index*, but not every detail slug. Search trusted sources first:
```
scripts/discover.sh --json "mega scizor raid guide"
scripts/discover.sh --json "10th anniversary party"
```
Search JSON records each LeekDuck/Hub/official/Fandom source as complete, partial or failed.
A `complete` zero-candidate result differs from partial/failed coverage; inspect usable candidate
rows plus `gaps` even on exit 1. The shared official news index and exact keyword result are reused
within the run, rather than force-downloaded per query. **Candidates are leads, not facts:** open
promising URLs once with `scripts/fetch.sh url --max-age 86400 --meta <URL>`, inspect the path, and
confirm exact identity/period/date before adding `links[]`. If nothing fits, record a gap — never
invent a URL.

**Catch events nobody told you about — `scripts/discover.sh new`.** After source preparation, run
`scripts/discover.sh new --cached --json` (standalone `new` refreshes by default). It retains usable
LeekDuck candidates alongside independent Hub/official URL leads, date-pending leads and malformed-entry
exceptions. Do not use a similar calendar title as coverage for a later same-named period; only an
exact retained URL or verified identity/date match closes that lead. Confirm each lead before writing.

---

## Content requirements

The order/dependencies/fix loop are in the already-embedded `daily-update.md`; briefs
specify each responsibility's inputs and outputs. Apply the shared rules here without
re-reading files. Detail/date triggers above bound the work, not the calendar's coverage.

### Calendar
update `public/data/events.json` **in place** (schema in `tasks/reference/daily-schemas.md`; surgical row
   edits — never a full-file rewrite). Backbone = `events`
   (ScrapedDuck); then **merge across sources**:
   - **Timing required.** Include complete `timing` in every new/changed row; reconcile the
     source's event coverage, time mechanism, each boundary and venue timezone independently.
     Explicitly mark unknowns/date-only; do not promote a legacy clock-looking string to `exact`
     on its own. Review retained pending timing on active/near/far-future events under the normal
     URL-body policy and hand the verified URL/basis to State + Validator. Both gates reject
     missing/invalid timing; never weaken them to publish a guessed instant.
   - **Dedup by event identity.** The same real-world event shows up in 2–4 sources
     (LeekDuck / Hub / pokébase / official). Decide which entries are the *same* event and
     emit **one** row — never two rows for one event.
   - **简体中文 titles.** Machine/source `heading` may remain English; visible canonical
     prose uses Chinese with the shared verified proper-name fallback. The event `name` (the calendar title) must be 简体中文 — never leave a
     source's English headline. Build it from the event's own verified 简体中文 `pokemon[]` name +
     its category, so it tracks whatever the source serves each run.
   - **Aggregate links — cover EVERY event** (every `type`, and every week through the end of
     next month — not just raids, and not just near-term events). This is a coverage
     requirement, not a daily re-search of already-verified events; use the shared review
     triggers. Do **not** just keep the LeekDuck link. For each event needing link work, find its match in `events-hub` / `events-pokebase` / `events-official` (by
     name + date) and add each **real** URL to `links[]` with a label (`LeekDuck` / `Hub` / `Pokébase`
     / `官方`). If a source clearly covers the event but the bulk feed didn't surface the URL, fetch it
     on demand (`scripts/fetch.sh url …`) and grab the real link. When no per-event article exists, a
     source's **generic category guide** (a schedule / guide page for that kind of event) is acceptable
     **only if that page genuinely covers this event**. **Use real URLs only — never guess or construct
     a link you haven't seen. Confirm each link is about THIS exact event/Pokémon — not a same-category
     article for a different subject; omit rather than attach a wrong one.** Most events should end up
     with ≥2 source links; do **not** settle for LeekDuck-only unless you actually checked the other
     sources and nothing fits. Keep `link` = the primary one. (Reuse known URLs; perform body rechecks under “Reuse and detail review”,
     including active/near/pending/operator-triggered events even when lists are unchanged.)
   - **Populate Pokémon, bonuses & a summary.** Fill `pokemon[]` (dex id + 简体中文 name + `shiny`),
     `bonuses[]`, and a **concise 简体中文 `summary`** (1–2 sentences) for every event from the articles —
     so the calendar isn't empty and the detail drawer is actually useful (not just a title + date).
   - **Inline the detail so users needn't click out.** For raid / mega / raid-day events, fill a
     **concise** `counters[]` (top picks + moves) from the Hub raid guide or `db.pokemongohub.net` —
     keep the calendar drawer light; the **exhaustive** counters + Mega pairings belong in the ranking
     当前团战 Counter tab. **Also emit the weekly Mega raid as its own `raid-battles` event** (Mega
     form sprite, same boss dex id as its rotation segment) so the Mega day-icon opens a drawer with
     counters + links, not just a name. Put any other useful detail in `sections[]` — **your call per
     event** (paid/ticketed options, special research, habitat hours, reward lists…), not a fixed set.
     All render as collapsible blocks.
   - **Flag long-running events.** Set `longTerm:true` on season / GO Pass and
     anything spanning more than ~2 weeks — they render in the 长期活动 band, not the day grid
     (this is what keeps headline short events visible). `longTerm:false` forces a borderline
     event back onto the grid. (You can also use `display:"banner"` to force long-term,
     or `display:"bar"` to force onto the grid — they mirror `longTerm:true`/`false`.)
   - **Flag PVP events.** Set `pvp:true` on GO Battle League seasons, 杯赛 (大师/超级/超等联盟杯),
     对战周末 / 对战日 and other PvP events — they render in the **PVP活动 band** (its own row under
     长期活动), not the day grid. `go-battle-league` is auto-classified; `pvp:false` forces an event
     out of the band; `display:"pvp"` mirrors `pvp:true`. PVP wins over 长期活动 when both apply.
   - **Include local / in-person events — don't skip them.** Region- or city-specific events
     (Safari Zone, City Safari, GO Tour 线下场, 区域线下活动, etc.) belong on the calendar too. Add
     them like any other event, and make the **location explicit** in the 简体中文 `name` / `summary`
     (e.g. "城市狩猎:大阪") so users see it's a 线下/local event. Never drop an event just because it
     is location-specific.
   - **Flag shiny-boost events.** Standard raid encounters/Raid Hours at base raid shiny
     rates are not boosted. Set `highlight:true` on 社区日, 团战日, and any event with
     **boosted shiny odds** → ✨ on the calendar. Also set `pokemon[].shiny:true` for the
     shiny-available mons and add a `bonuses[]` line like "✨ 闪光概率提升" so the detail drawer shows it.
     Note: `highlight` only adds the ✨ indicator; the **gold border** is controlled separately by
     `featured.json` (admin-curated, see above). Do not conflate the two.
   - **New event types.** If a source introduces a `type` that isn't styled yet (it would otherwise
     fall back to a generic grey marker), register it in `public/data/categories.json` with a palette
     key + 简体中文 label + kind (see `tasks/reference/daily-schemas.md`). Assign the family colour that fits — you can't pick a hex.
   - **Retention.** Forward: keep **at least the current month through the end of next month**;
     a confirmed, already-announced farther-future event (e.g. a GO Tour / City Safari date) may
     stay — but note `discover.sh new` only sweeps through the end of next month. Backward:
     **drop events that ended more than ~90 days (≈3 months) ago** (validate.sh hard-rejects events
     ended >90 days ago, so prune well before that — but do NOT prune at the month boundary: the
     calendar has a ‹ 上月 button, and blanking last month loses real history). Use a **stable `id`**
     so re-runs map the same event to the same row and can never accumulate duplicates.
     **ID algorithm:** when the source provides a slug / feed id (ScrapedDuck's `eventID` =
     LeekDuck's URL slug), use it **VERBATIM** — `discover.sh new` dedups by comparing feed
     `eventID`s against your `id`s **exactly**, so any "normalizing" or renaming makes every
     already-covered event resurface as NEW forever. Real examples in current use:
     `june-communityday2026`, `raidhour20260617`, `road-of-legends-2026`. Only when no source slug
     exists, compose `<type>-<startYYYYMMDD>` (e.g. `spotlight-hour-20260701`). Never use sequential
     counters or random values.
### Rotations
update `public/data/rotations.json` (schema in `tasks/reference/daily-schemas.md`; edit segments in place —
   if the processed monthly body, `raids.json` and finalized Calendar inputs are unchanged
   and the month is current, keep the file as-is): the **current month's**
   5★ / Mega / Max weekly boss rotation, parsed from the Hub monthly article and corroborated
   with `data/raw/raids.json`. **The monthly article's body is NOT in `events-hub.txt`** (that
   file is only the `/post/event/` index): find the article's URL in the index (or via
   `scripts/discover.sh "raid bosses <month> <year>"`) and open it with `scripts/fetch.sh url <URL>`
   using the shared cache policy (reuse Scout's successful read) before parsing. Dex id per boss for the sprite; dates `YYYY-MM-DD`.
   **Parse the bosses — never invent them.**
### Rankings
refresh the regions in `index.html` — but only those whose inputs changed:
   keep static tier panels when their processed sources are unchanged; evaluate live raid
   and editorial regions independently under “Quiet-day and date advancement”:
   - `rankings-attackers` / `rankings-defenders` → parse the tier tables from
     `data/raw/tiers-*.txt` (S/A/B…, Pokémon, recommended moves); cross-check with
     `tiers-pokebase`. Surface the attackers page's **per-type 属性榜** (best pick per type).
     Render as `.rank-list` / `.rank-item` with a `.tier tier-S|tier-A|…` badge and a sprite.
     (Jina output is markdown: `## S Tier` … headers + tables. A Pokémon's national-dex id is
     embedded in its artwork URL, e.g. `…/detail/861_gmax.png` → id 861; strip suffixes like
     `_gmax`. **Adapt if the layout changes. Parse the lists — do not decide rankings yourself.**)
   - `rankings-raid` (**当前团战 Counter**) → counters for what's **live right now**: current raid
     bosses from `data/raw/raids.json` **and any active Max/Dynamax battle**. This tab is the
     **detailed** reference (the calendar drawers stay concise). **Sort bosses by tier, highest first**
     (传说/5★ → 超级/Mega → 3★ → 1★ → 暗影 → Max). Render **each boss as a header with a large sprite**
     (`.raid-block` > `.raid-boss` with a `.boss-icon` + 简体中文 name + a `.meta` line), then a
     **fuller** counter list in a **`.rank-list.mini`** below — the boss reads bigger than its counters.
     **属性用图标,不用文字:** in the boss `.meta` render its 属性 and 弱点 as
     `<img class="ico" src="assets/icons/<type>.<ext>">`, and **prepend each counter's move 属性 icon(s)**
     before its move text (move→type from `gamemaster`). Type files vary by extension — see the map in
     *Ranking HTML pattern* (`一般` = `normal.webp`, like every other type). Justify counters/types with
     `gamemaster`; don't invent.
   - **Mega Booster — inline on each boss, NOT a separate bottom list.** Mechanic: an **active** Mega
     gives **+1 糖 when you catch a Pokémon sharing that Mega's 属性** (chance of extra / XL) — it is
     **not** "evolving yields that species' candy" and has nothing to do with evolving. For each boss,
     put a **`.raid-mega`** 4-列网格 to the **right of the boss header** showing **6–8** same-属性 超级
     sprites that farm **that boss's** candy (`<img title="超级X · 共享<属性>">`), **sorted by 超级 attack
     high→low, hard cap 8** (the 头右 grid fits 8 in 2 rows of 4). List
     as many as actually share the 属性 — don't pad with off-type Mega, and don't drop below the real count
     just to hit 6. Build the pairings from whatever bosses are live this run — never hard-code a fixed
     list. **Label the Mega by the 属性 it *shares* with the boss** (that shared type drives the candy) —
     never paste the boss's own 属性 onto the Mega; verify each 属性 / 弱点 against `gamemaster`, and
     **cross-check which 超级 actually exist in PoGo against a live source** (`serebii.net/pokemongo` or
     `pokemongo.fandom.com`) — `gamemaster`'s Mega list lags new releases.
   - `rankings-current` (本期推荐, **free-form, highest value**) → **editorial / priority**, not a
     counter dump: which live events to do this period (社区日/团战日/Max周一/聚焦), bonuses, shiny
     windows, and a directional "练哪类攻手". Full counter tables belong in 当前团战 Counter — point
     there, don't duplicate them (see *Free-form synthesis* below).
   - `calendar-notes` (**free-form**) → a short 本月看点 (see *Free-form synthesis* in `tasks/reference/daily-schemas.md`).
### Shared final checks

Apply the public schemas in `tasks/reference/daily-schemas.md`, the render contract and inert-HTML rules. Spot Atlas remains
operator-only (see its schema); English mirrors finalized canonical content in responsibility
40. State/meta and gates belong to responsibility 90, with the bounded fix loop in
`daily-update.md`. Never ship empty regions or replace failed source content with blanks.
Never leak raw paths, scripts, fetch mechanics or bookkeeping into visible summaries,
bonuses, sections or AI HTML; source-health notes belong in state, not the dashboard.

---

## 按需参考（受保护）

`tasks/reference/daily-schemas.md` 保存 JSON 完整结构、Spot Atlas 约束、HTML 示例、属性图标映射与 English overlay 细则。处理对应文件前按需读取相关小节；不要在每轮开始重复载入全文。本文以上的范围、来源覆盖、缓存/恢复、日期推进、双语与失败规则始终生效。
