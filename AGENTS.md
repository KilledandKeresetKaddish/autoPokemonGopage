# AGENTS.md — pogo-agent daily operator guide

This repository is a **self-contained Pokémon GO dashboard**. One non-interactive Pi
runs **once per day** (via `scripts/run-daily.sh` from cron) with this directory as
its working directory. Each run you refresh the site's content from trustworthy
sources and write it into the files listed under **"What you may edit"**. The wrapper
then runs `scripts/validate.sh` and either publishes your changes (git commit) or
saves a pending draft before rolling the working tree back.

You are the **brain**. The deterministic scripts only download bytes — *you* decide
what to fetch, whether it's even needed today, and how to interpret it. Third-party
formats change: never assume fixed field positions; **re-read and adapt every run.**

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
agents or parallel workstreams in a daily run. The wrapper has embedded this complete
file, `tasks/daily-update.md`, and all six briefs exactly once. Do not re-read them just
to load them again; only after genuine context compaction may you re-read the specific
passage that was actually lost.

**You have full network access — use it, never refuse.** You reach the internet **only**
through `scripts/fetch.sh` and `scripts/discover.sh` (plain Bash commands). You do **not** have
a model-hosted browser or `web_search` tool — so don't wait for one, and **never tell the
operator you "have no internet / network / search access."** That is false: those two scripts
*are* your access, and on this host they run without a sandbox. Whenever a request needs anything
you can't already confirm from the cache in `data/raw/*` — a link, a date, a bonus, a spawn, a
shiny, a counter, a Pokémon/move name — **go get it yourself, before you edit or reply**, in this
order:
1. **Find the URL** — `scripts/discover.sh "<english keywords>"` returns candidate URLs on the
   trusted sources. (This is the step `fetch.sh` can't do: `fetch.sh` only downloads URLs you
   already know; `discover.sh` *finds* them.)
2. **Open & read it** — `scripts/fetch.sh url <URL>` (or the relevant named bulk source).
3. **Then edit**, using only what you actually read. **Never guess or hand-build a URL, and never
   leave a placeholder that blames missing access** — discover, fetch, verify, or omit.

**Never write a Pokémon name or move from memory.** Every 简体中文 Pokémon name and move you
emit — events `pokemon[]`/`counters[]`, rotation segment names, ranking panels — must be
confirmed against `data/raw/gamemaster.json` (dex → species / move) or an allowlisted
`pokeapi.co` lookup *before* you write it. If you cannot verify it, omit it or keep the
source's English/romanized form — a hallucinated or garbled name is worse than none, and
`validate.sh` only checks **structure**, so it cannot catch a wrong name.

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
  canonical `name` field rules under “Spot Atlas schema” below.
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
  Your **one and only job** here: when the game announces a NEW Mega/Primal, **append one row**.
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
- Keep `public/data/*.json` and `public/data/i18n/*.json` valid JSON in the schemas below.
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
Start by running `scripts/fetch.sh list` and reading `data/state.json` to see what is
already cached and how old it is. **Decide what to refresh by age — do not blindly
refetch everything.** `list` prints each cache's sha256 (16 hex) — compare it with the
`sha256` recorded per source in `data/state.json`: **an unchanged hash means every
conclusion you drew from that source last run still stands** — do not re-parse,
re-verify, or re-derive content from it. Then read *what changed* in `data/raw/`
(grep/jq the big files — see *Token discipline* below).

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
> whatever form it's in; **never assume fixed positions — re-read every run.**
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
4. **Verify links once.** A `links[].url` you verified in a previous run — it is already in
   `events.json` and its event is unchanged in the sources — is **trusted**: do not re-open it.
   Re-verify only newly added links and links on events whose source entry changed.

**Quiet-day fast path.** If `events`, `events-hub`, `events-official`, `events-pokebase` and
`raids` all re-fetch to an **unchanged hash**, skip rebuilding calendar/rotation content
entirely: do only date-driven maintenance (prune events ended >90d and their `featured.json`
ids, flags that flip with the calendar), update `meta.json` + `data/state.json`, and leave the
ranking regions **and their English overlay regions** as-is when the `tiers-*` caches
are also unchanged. If retention/date-driven maintenance changes any canonical ID or
visible Chinese region, update only the matching English overlay entry/region. Then
still run `preflight.sh` + `validate.sh` as usual.

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

**Don't know the URL? Discover it — don't guess.** The feeds give you every LeekDuck link and the
Hub *index*, but not a specific Hub **guide/article** slug (e.g. a per-boss raid guide). When you
need a page whose URL you don't already have, search the trusted sources first:
```
scripts/discover.sh "mega scizor raid guide"
scripts/discover.sh "10th anniversary party"
```
It matches LeekDuck via the cached `events` feed, searches Pokémon GO Hub (its on-site search) and the
官方 news index through the Jina solver, **and queries the Pokémon GO Wiki (Fandom) MediaWiki search API
directly** — so a region-/local-only event with only a Fandom page is still discoverable. It prints
`SOURCE <tab> TITLE <tab> URL` candidates (also saved under
`data/raw/discovery/`). **Candidates are leads, not facts:** open each promising one with
`scripts/fetch.sh url <URL>`, confirm it is the *exact* same event/Pokémon (right boss, right
month), and only then add it to `links[]`. If nothing fits, record the gap in `data/state.json` —
never invent a link.

**Catch events nobody told you about — `scripts/discover.sh new`.** To find activities that turned
up in the feeds this cycle but aren't on the calendar yet (an official "surprise" event, a new raid
day…), run `scripts/discover.sh new`. It re-fetches the feeds and lists feed events **within the
current + next-month window** that are missing from `public/data/events.json`, each tagged with
cross-source corroboration (`佐证:LeekDuck[+Hub][+官方]`), plus any official news links not tied to a
known event. These are leads: open each with `scripts/fetch.sh url <URL>`, confirm it, then add it —
read before you write, as always.

---

## Daily procedure
1. `scripts/fetch.sh list` + read `data/state.json` → decide what is stale, and note which
   caches' sha256 match last run's recorded hashes (those sources need **no** re-derivation).
2. Fetch only what's needed, e.g.
   `scripts/fetch.sh events raids events-hub events-pokebase tiers-attackers`.
3. Read what changed in the raw files (grep/jq the big ones — *Token discipline*); adapt to
   their **current** structure. If nothing event-bearing changed, take the quiet-day fast path.
4. **Calendar** → update `public/data/events.json` **in place** (schema below; surgical row
   edits — never a full-file rewrite). Backbone = `events`
   (ScrapedDuck); then **merge across sources**:
   - **Dedup by event identity.** The same real-world event shows up in 2–4 sources
     (LeekDuck / Hub / pokébase / official). Decide which entries are the *same* event and
     emit **one** row — never two rows for one event.
   - **简体中文 titles.** The event `name` (the calendar title) must be 简体中文 — never leave a
     source's English headline. Build it from the event's own verified 简体中文 `pokemon[]` name +
     its category, so it tracks whatever the source serves each run.
   - **Aggregate links — actively, for EVERY event** (every `type`, and every week through the end of
     next month — not just raids, and not just near-term events). Do **not** just keep the LeekDuck
     link. For each event, find its match in `events-hub` / `events-pokebase` / `events-official` (by
     name + date) and add each **real** URL to `links[]` with a label (`LeekDuck` / `Hub` / `Pokébase`
     / `官方`). If a source clearly covers the event but the bulk feed didn't surface the URL, fetch it
     on demand (`scripts/fetch.sh url …`) and grab the real link. When no per-event article exists, a
     source's **generic category guide** (a schedule / guide page for that kind of event) is acceptable
     **only if that page genuinely covers this event**. **Use real URLs only — never guess or construct
     a link you haven't seen. Confirm each link is about THIS exact event/Pokémon — not a same-category
     article for a different subject; omit rather than attach a wrong one.** Most events should end up
     with ≥2 source links; do **not** settle for LeekDuck-only unless you actually checked the other
     sources and nothing fits. Keep `link` = the primary one. (Verification effort goes to **new or
     changed** events — links already verified in a previous run on unchanged events are trusted;
     see *Token discipline* rule 4.)
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
   - **Flag shiny-boost events.** Set `highlight:true` on 社区日, 团战日, and any event with
     **boosted shiny odds** → ✨ on the calendar. Also set `pokemon[].shiny:true` for the
     shiny-available mons and add a `bonuses[]` line like "✨ 闪光概率提升" so the detail drawer shows it.
     Note: `highlight` only adds the ✨ indicator; the **gold border** is controlled separately by
     `featured.json` (admin-curated, see above). Do not conflate the two.
   - **New event types.** If a source introduces a `type` that isn't styled yet (it would otherwise
     fall back to a generic grey marker), register it in `public/data/categories.json` with a palette
     key + 简体中文 label + kind (see schema). Assign the family colour that fits — you can't pick a hex.
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
5. **Rotations** → update `public/data/rotations.json` (schema below; edit segments in place —
   if the monthly article and `raids.json` are hash-unchanged and the month is current, keep the
   file as-is): the **current month's**
   5★ / Mega / Max weekly boss rotation, parsed from the Hub monthly article and corroborated
   with `data/raw/raids.json`. **The monthly article's body is NOT in `events-hub.txt`** (that
   file is only the `/post/event/` index): find the article's URL in the index (or via
   `scripts/discover.sh "raid bosses <month> <year>"`) and open it with `scripts/fetch.sh url <URL>`
   before parsing. Dex id per boss for the sprite; dates `YYYY-MM-DD`.
   **Parse the bosses — never invent them.**
6. **Rankings** → refresh the regions in `index.html` — but only those whose inputs changed:
   if the `tiers-*` caches are hash-unchanged since last run and the live boss set didn't
   change, keep the corresponding structured panels as-is (they were verified when written):
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
   - `calendar-notes` (**free-form**) → a short 本月看点 (see *Free-form synthesis*).
7. **Spot Atlas (operator-note only)** → leave `public/data/locations.json` byte-for-byte
   unchanged on ordinary daily runs. When an explicit operator note requests a location change,
   update only the affected row(s): retain a stable URL-safe `id`; keep exactly one untranslated
   `name`; copy coordinates/timezone/note from the operator rather than inventing or geocoding;
   validate the supplied IANA `timeZone`; and never persist flags, offsets, next-target times,
   browser times or map URLs. Locale switching must not create an English/Chinese name variant.
8. **English text layer** → after Calendar, Rotations and Chinese Rankings are fully
   finalized, update `public/data/i18n/en.json` surgically. Facts are interpreted once:
   translate text only, keep exact canonical event IDs, custom-category/track keys and
   nested-array lengths/order, and translate all five wrapper inner-HTML regions while
   preserving classes, URLs, `data-event-id`, sprites and numeric facts. Remove overlay
   rows for pruned events. Verify official English Pokémon/move names from column 2 of
   `scripts/fetch.sh zh …` or the exact English source spelling. English visible content
   must contain no CJK fallback. On a quiet day with unchanged canonical content, leave
   the already-verified overlay unchanged.
9. In the final State + Validator responsibility, set `public/data/meta.json`
   `lastUpdated` to now (ISO 8601) and record per-source fetch times/notes in
   `data/state.json` (a fixed object keyed by source — **not** a growing log). Earlier
   responsibilities collect gaps/notes but do not write state; you write it once here
   after the canonical and English content are finalized.
10. **Self-check before validating:** one row per real event (no duplicate `id`s), `links[]`
   aggregated (≥2 sources per event where possible), no event ended >3 months ago, long events
   flagged, rotations parsed not invented, `highlight` only on Community Day / Raid Day /
   boosted-shiny events (standard raid encounters at base shiny rate do NOT qualify),
   `featured.json` pruned of stale IDs (events no longer in `events.json`),
   **every 简体中文 name/move verified against `gamemaster` or PokeAPI (no hallucinated or
   garbled names)**, all `links[].url` actually confirmed to exist and point to THIS event
   (not a same-category article for a different Pokémon), every Chinese AI marker retains
   its `data-ai-region` wrapper, and English overlay IDs/arrays/regions exactly mirror the
   finalized canonical content with verified English names and no Chinese leakage. If an operator
   requested a Spot Atlas edit, also verify unique ids, non-empty single `name`, valid IANA zones,
   unchanged schedule shape, and absence of every runtime-only field listed below.
11. Run `scripts/validate.sh`. Fix what it reports until it passes. (It hard-rejects duplicate
   ids, >250 **or <5** events, events ended >90 days ago, empty `id`/`name`/`start`/`type`,
   `end` earlier than `start`, dangerous HTML in either language's rich regions, **any empty AI region**
   (all five per language must have content — never blank one to "start clean"), bilingual
   ID/shape drift or CJK text in the English overlay, missing `public/data/*.json` /
   `data/state.json` files, a `featured.json` that isn't an array of ids all present in
   `events.json`, more than one `<script>` tag, protected-file changes, and rotation segments
   without `start`/`pokemon[]` — so prune, dedup, and check.)

---

## Schemas

`public/data/events.json` — array the calendar + 长期活动 band render:
```json
{
  "id": "slug-string",
  "name": "活动名称",
  "type": "community-day",
  "heading": "Community Day",
  "summary": "一句话简体中文说明(显示在详情抽屉)。",
  "start": "2026-06-01T10:00:00",
  "end": "2026-06-01T13:00:00",
  "image": "https://cdn.leekduck.com/....png",
  "link": "https://leekduck.com/events/....",
  "links": [
    { "label": "LeekDuck", "url": "https://leekduck.com/events/...." },
    { "label": "Hub", "url": "https://pokemongohub.net/post/event/...." }
  ],
  "bonuses": ["双倍星尘", "..."],
  "pokemon": [{ "name": "皮卡丘", "id": 25, "shiny": true }],
  "counters": [{ "id": 248, "name": "班基拉斯", "fast": "齿突", "charged": "啃咬" }],
  "sections": [{ "title": "付费内容", "items": [":pokeball: 票务 4.99 美元", "..."] }],
  "longTerm": false,
  "highlight": false
}
```
- `start`/`end` ISO 8601; `end` may equal `start`. `summary`/`bonuses`/`pokemon`/`links`/`longTerm`/`highlight` optional.
- `summary`: a **concise 简体中文** description (1–2 sentences), shown as a paragraph in the detail drawer
  so the panel isn't just a title + date.
- **Sprites & forms:** `pokemon[]` / `counters[]` / rotation segments take `id` (national-dex →
  `…/sprites/pokemon/<id>.png`) + 简体中文 `name` (+ `shiny`). The base id shows the **base** sprite —
  for **Mega / Primal / Gigantamax / regional** forms set the form's sprite instead: use the form's
  PokeAPI *pokemon* id as `id`, or add `"sprite": "<url>"` from `pokeapi.co/api/v2/pokemon/<name>/`
  (`sprites.front_default`; e.g. `scizor-mega`, `skarmory-mega`, `raichu-mega-x`). pokeapi.co is allowlisted.
  **Exception — rotation Mega segments:** keep `id` = the **base** dex (matching that boss's
  `events.json` entry) and use the `"sprite"` override for the mega look; a mega-form `id` there breaks
  the day-icon → raid-event link (see the rotations.json schema note below).
- **Clickable sprites → Hub DB (automatic).** Every Pokémon sprite the site renders — event drawer,
  weekly rotations, all ranking panels, the free-form notes — is **auto-linked** to
  `https://db.pokemongohub.net/pokemon/<id>` by `app.js`; you don't hand-write `<a>` tags. (Only the
  **calendar grid day-icons + 长期/PVP band** are left un-linked, because their icons/pills open the
  in-page drawer.)
  A base `id` only links to the base page, so for a **form** add an optional **`hub`** slug on that
  `pokemon[]` / `counters[]` / rotation-segment entry to hit the exact form page: `"hub": "212-Mega"` ·
  `"150-Mega_Y"` · `"77-Galarian"` · `"105-Alolan"` (id `-Form`, `_` for X/Y). In the **static** ranking
  HTML put the same on the `<img>` as `data-hub="212-Mega"`; plain base-id sprites need nothing.
- `counters`: best raid/团战 counters (`id` for the sprite + 简体中文 `name` + optional `fast`/`charged`
  moves) → rendered as a collapsible "团战 Counter" block. Fill for raid / mega / raid-day events from the
  Hub raid guide or `db.pokemongohub.net`, justified by `gamemaster` — **don't invent**.
- `sections`: **free-form** collapsible blocks `[{ "title": "...", "items": ["..."] }]` or
  `[{ "title": "...", "body": "一段文字" }]` (`body` renders as a paragraph instead of a list) or
  `[{ "title": "...", "mons": [{ "id": 144, "name": "急冻鸟", "shiny": true }, …] }]` (`mons` renders as a
  **caption-less sprite-icon grid** — dex `id` + sprite/hub conventions like `pokemon[]`/`counters[]`; name
  shows only on hover, no text/moves) — **you decide
  per event** what's worth surfacing (付费/票务、限时调查步骤、栖息地时段、Field Research 任务、奖励清单…).
  Titles and contents are yours to choose; 付费内容 is just one example. Use them to bring the useful
  detail inline instead of forcing users out to the source link.
- **Icons:** the repo ships icons in `public/assets/icons/`, **always at a locked size** via the `ico`
  (inline) / `ico-lg` (standalone) class. In `bonuses`/`sections` text use a `:token:` (e.g.
  `:stardust: 捕捉星尘 ×3`, `:water: 水属性`); in the free-form regions write
  `<img class="ico" src="assets/icons/<file>">`. Tokens — types: `bug dark dragon electric fairy fighting
  fire flying ghost grass ground ice normal poison psychic rock steel water`; items: `candy xl-candy rare-candy
  stardust xp lure incense incubator golden-razz silver-berry pokeball pokestop raid spawn rocket trading`.
  Unknown tokens fall back to `<token>.png`; missing files hide. Use where it adds clarity (e.g. a type
  icon next to a counter, an item icon next to a bonus). **Only use tokens from the two lists above** —
  invented ones (`gift`, `research`, …) have no asset and render blank (`preflight.sh` warns). And the
  `:token:` regex eats any `:…:`, so **never put a time like `7/7:18:00` in `bonuses`/`sections`** — the
  `:18:` is swallowed and the line shows mangled; write `7/7 18:00` (space, not colon).
- `link` (single) is kept for back-compat; prefer `links[]` to point at **every** source for the event.
- `longTerm:true` → renders in the 长期活动 band instead of the grid (auto for season/pass
  and spans >~2 weeks; set `false` to force back onto the grid).
- `pvp:true` → renders in the **PVP活动 band** instead of the grid (auto for `go-battle-league`;
  use for 杯赛 / 对战周末 / 对战日; set `false` to force back onto the grid; `display:"pvp"` mirrors it).
  Checked before `longTerm`, so a long PVP season lands in PVP, not 长期活动.
- `highlight:true` → ✨ indicator on the calendar bar/chip (shiny boost). Set it for 社区日
  (Community Day), 团战日 (Raid Day), and any event with **boosted shiny odds**. Put the shiny detail
  in `pokemon[].shiny` (✨ on the sprite) and add a `bonuses[]` line like "✨ 闪光概率提升".
  The gold border is driven separately by `featured.json` (admin-controlled); `highlight` no longer
  controls the border.

`public/data/rotations.json` — the current month's weekly boss rotation:
```json
{
  "month": "2026-06",
  "note": "5★/超级团战每周三轮换 · Max 团战每周轮换",
  "tracks": [
    { "key": "5star", "label": "5★ 团战", "color": "#d8b25f", "tag": "5★",
      "segments": [
        { "name": "Zekrom", "cn": "捷克罗姆",
          "pokemon": [{ "id": 644, "name": "捷克罗姆" }],
          "start": "2026-06-10", "end": "2026-06-16" }
      ] },
    { "key": "mega", "label": "超级团战", "color": "#9c7bb0", "tag": "M", "segments": [ "…" ] },
    { "key": "max",  "label": "极巨团战", "color": "#bd7f97", "tag": "MX", "segments": [ "…" ] }
  ]
}
```
- Tracks 5★ / Mega / Max (+ any future tier). `cn` = displayed name; `pokemon[]` may hold >1 boss
  (dual/triple rotations — they **cycle** inside one day-number icon). `start`/`end` = `YYYY-MM-DD`.
- **Every track with `pokemon` renders as small icons next to each day's number** (the grid no longer
  draws weekly-raid bars). So keep rotations.json **complete for the whole month**, or those raids
  vanish from the grid. `color` drives both the rotation section and the day-icon ring — 5★ = gold
  `#d8b25f`, Mega = purple `#9c7bb0`, Max = mauve `#bd7f97`. `tag` (**≤2 chars**) is the icon's corner
  badge — set it on every track (5★/M/MX are built-in fallbacks; a new tier with no `tag` falls back to
  the first 2 letters of its `key`). To keep a track **out** of the day cells, set `"showOnCalendar": false`.
- **A Mega/5★ day-icon links to its raid event by *dex id* — keep the id consistent.** Clicking an
  icon opens the drawer of the matching `events.json` raid (its counters / links / summary). The
  matcher compares `pokemon[].id`, so a rotation segment **must use the SAME id as that boss's
  `events.json` raid entry** — i.e. the **BASE national-dex id** (Mega 巨钳螳螂 → `212`, *not* the
  mega-form id `10046`), with the mega look supplied via `"sprite"`. Put a mega-form id here and the
  icon opens a **bare, link-less drawer** (it can't find its event — this is a real bug, not cosmetic).

`public/data/locations.json` — Spot Atlas stable facts (operator-note maintenance only):
```json
{
  "schemaVersion": 1,
  "schedule": { "isoWeekday": 2, "hour": 20, "minute": 0 },
  "spots": [{
    "id": "stable-url-safe-id", "countryCode": "TH", "name": "Ban Phue",
    "lat": 17.688021, "lng": 102.473581, "timeZone": "Asia/Bangkok",
    "kind": "gym", "status": "tested", "group": null, "rating": null,
    "needsReview": false, "note": "人少、资源也较少"
  }]
}
```
- `name` is the only location-name field: required, string, trim-non-empty, and shown verbatim
  in both locales. Never add `nameZh` / `nameEn`, and never put spot names in an i18n file.
- `schedule` contains only `isoWeekday` / `hour` / `minute`; never add `displayTimeZone`.
  Each row's `timeZone` is an IANA zone for that location. The viewer's display zone is detected
  at runtime by the browser and is never stored here or selected from the website locale.
- Never infer a timezone from longitude and never save a fixed offset. The following are runtime
  derivatives and forbidden in every spot row: `flag`, `utcOffset`, `browserTime`, `displayTime`,
  `chinaTime`, `nextTuesday`, `mapUrl`.
- Keep `id` stable and lowercase URL-safe; `countryCode` is uppercase ISO alpha-2; latitude /
  longitude are numeric and in range, and two rows may not share the exact same numeric pair.
  `kind` is exactly `gym` / `showcase` / `both`; `status` is exactly `tested` / `candidate` /
  `mixed`; `rating` is exactly `null` / `1` / `2` / `3` (integers only); `group` is null or a
  non-empty string; `needsReview` is boolean; `note` remains the operator's original text.
  Add/change/remove rows only from explicit operator facts—do not discover, translate, geocode or
  “clean up” them on your own.

`public/data/meta.json`:
```json
{ "lastUpdated": "2026-06-15T08:00:00Z", "note": "optional short status" }
```


`public/data/i18n/en.json` — English text-only overlay over the canonical files:
```json
{
  "version": 1,
  "events": {
    "canonical-event-id": {
      "name": "English title", "heading": "English heading", "summary": "English summary",
      "bonuses": ["same count/order as canonical bonuses[]"],
      "pokemon": ["English name per canonical pokemon[] entry"],
      "counters": [{ "name": "English Pokémon", "fast": "English move", "charged": "English move" }],
      "sections": [{ "title": "English title", "items": [], "body": "", "mons": [] }]
    }
  },
  "rotations": {
    "note": "English note",
    "tracks": { "5star": { "label": "5★ Raids", "segments": [
      { "name": "English name", "cn": "English display name", "pokemon": ["English names"] }
    ] } }
  },
  "categories": { "every-custom-category-key": "English label" },
  "regions": {
    "calendar-notes": "<inert English inner HTML>",
    "rankings-current": "<inert English inner HTML>",
    "rankings-attackers": "<inert English inner HTML>",
    "rankings-defenders": "<inert English inner HTML>",
    "rankings-raid": "<inert English inner HTML>"
  }
}
```
- It contains **text only**. IDs/dates/URLs/dex IDs/sprites/flags/mechanics remain in
  canonical files and are never duplicated here.
- `events` keys exactly equal canonical event IDs. `bonuses`/`pokemon`/`counters`/
  `sections`, and each section's `items`/`mons`, exactly mirror canonical lengths/order.
  Use empty arrays/strings only where the corresponding canonical field is absent.
- Rotation tracks are keyed by canonical `track.key`; segment arrays and their Pokémon
  name arrays exactly mirror canonical order/length. `categories` keys exactly equal
  `categories.json` keys.
- `regions` values are the inner HTML only (no marker/wrapper); same inert-HTML and class
  policy as Chinese. All five are required and non-empty. `validate.sh` rejects any CJK
  character in this English file to prevent mixed-language fallback.
- `public/data/i18n/ui.json` is the owner-maintained static UI dictionary. It is
  checksum-protected and **never** a daily-agent write target.

`public/data/categories.json` — register NEW event types (colours are code, you assign a family, not a hex):
```json
{ "some-new-type-slug": { "palette": "blue", "label": "新活动类型", "kind": "bar" } }
```
- Only needed when a source introduces a `type` not already styled (the common ones —
  community-day, raid-battles, raid-day, raid-hour, research, choose-your-path, event,
  go-battle-league, spotlight-hour / pokemon-spotlight-hour, max-mondays, go-pass, season,
  pokemon-go-fest — are **built in**; don't re-add them). Otherwise leave this `{}`.
- `palette` MUST be one of the theme keys (assign the colour **family**, you cannot invent a hex):
  `purple` 旗舰 · `green` 社区日 / `greenlt` 聚焦时刻 · `rust` 团战Boss / `orange` 团战时刻 /
  `red` 团战日(特殊单日) · `teal` 调查 / `teallt` 限时调查 · `blue` 活动 · `indigo` 对战联盟 ·
  `mauve` Max周一 · `gold`·`brown` 长期 band. Pick the family that matches the activity.
- `kind`: `bar` (spans days) or `chip` (single-day marker); optional `bg:true` for a muted band.
- Validation **rejects** off-palette colours or a bad `kind`, so you can't drift off-theme.

## Free-form synthesis (your creative space)
`calendar-notes` (本月看点) and `rankings-current` (本期推荐) are **free-form inert-HTML
canvases** — compose them freshly each run with judgment. The other regions
(`rankings-attackers/defenders/raid`) stay structured: parse the sources, don't free-style.
Inside each marker, preserve its existing `<div data-ai-region="…">` and write Chinese
content inside that wrapper; English Curator copies the finalized meaning/structure into
`en.json.regions` (without the wrapper itself). Use **only** these whitelisted,
theme-correct classes (no inline colors, no `<style>`, no `<script>`):
- containers: `.panel` / `.panel-head`, `.note-grid` (auto-responsive columns), `.callout` (highlight box)
- lists/atoms: `.rank-list` / `.rank-item`, `.pill` / `.pillrow`, `.badge`, `.btn` / `.btn-primary`, `.muted`,
  `.meta`(rank-item / boss 头里的小字附注行)
- Pokémon/tiers: `.mon-icon`, `.mon-row` / `.mon` / `.shiny`, `.tier` + `.tier-S|tier-A|tier-B|tier-C`
- sprites/icons: `<img class="spr">` or `class="mon-icon"` (PokeAPI dex-id URL); `<img class="ico">` /
  `class="ico-lg"` for the local resource icons in `assets/icons/` (size locked).
- **clickable event names** (本月看点 = `calendar-notes`): wrap a headline event's name in
  `<span class="event-link" data-event-id="<events.json id>">名称</span>` (a `<span>`, or an `<a>` with no
  `href`) — `app.js` opens that event's detail popup on click (underline marks it clickable). The
  `data-event-id` **must** equal an existing `events.json` `id` (an unknown id just stays inert text, so
  prune links when you remove the event). Use it to let 本月看点 jump to a drawer; the popup only opens on
  the calendar view, so keep these in `calendar-notes`, not the rankings regions.
- current-raid blocks (structured `rankings-raid` only): one **`.raid-wall`** (3-up card grid) wrapping
  per-boss **`.raid-block`** cards. Each card = a **`.raid-boss`** header (`<img class="boss-icon">` +
  **`.binfo`**, which holds a **`.btop`** badge/name row above a **`.meta`** 属性/弱点 row) and a
  **`.raid-mega`** 4-列网格 of **6–8** same-属性 Mega sprites pinned to the header's right (no text label —
  `.lbl` is CSS-hidden), with **`.rank-list.mini`** **flat** counter rows beneath (`mon-icon` / `strong` /
  `.meta` are siblings — no wrapper `<div>` — so the move `.meta` right-aligns). Type icons via `.ico`.

`rankings-current` should tie today's live events + current raid bosses to the best
attackers/tanks to use (e.g. a Max/Dynamax event → the relevant Max picks).

## Ranking HTML pattern (use the existing CSS classes)
```html
<div class="rank-list">
  <div class="rank-item">
    <span class="tier tier-S">S</span>
    <img class="mon-icon" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/384.png" alt="烈空坐">
    <div><strong>烈空坐</strong><div class="meta">龙息 / 画龙点睛</div></div>
  </div>
</div>
```
当前团战 Counter — **按星级从高到低**;**全部 boss 卡放进一个 `.raid-wall`(每行 3 张)**。每张卡:boss 头
(`.binfo` 里 `.btop` 档次/名 一行,`.meta` 属性/弱点 一行)+ **头右 `.raid-mega` 4-列网格(6–8 个同属性
超级,按超级攻击力高→低,上限 8,无文字标)** + **拍平的** `.rank-list.mini` counter 行(`mon-icon` /
`strong` / `.meta` 平级,招式 `.meta` 右对齐)。**属性一律用图标**。占位符按本轮实际 boss 填:
```html
<div class="raid-wall">
  <div class="raid-block">
    <div class="raid-boss">
      <img class="boss-icon" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/<bossDexId>.png" alt="<boss 名>">
      <div class="binfo">
        <div class="btop"><span class="badge">&lt;档次&gt;</span><strong>&lt;boss 名&gt;</strong></div>
        <div class="meta"><img class="ico" src="assets/icons/<type>.webp" alt="<属性>"> · 弱 <img class="ico" src="assets/icons/<weak>.webp" alt="<弱点>"></div>
      </div>
      <!-- 头右 Mega:6–8 个同属性超级,按超级攻击力排序,上限 8,无 .lbl 文字标 -->
      <div class="raid-mega">
        <img src="…/<megaFormDexId>.png" data-hub="<dexId>-Mega" title="超级X · 共享<属性>" alt="超级X">
        <!-- …其余同属性 Mega(共 6–8 个)… -->
      </div>
    </div>
    <div class="rank-list mini">
      <div class="rank-item"><img class="mon-icon" src="…/<counterDexId>.png" alt="<counter 名>"><strong>&lt;counter 名&gt;</strong><div class="meta"><img class="ico" src="assets/icons/<moveType>.webp" alt="<招式属性>"> &lt;fast&gt; / &lt;charged&gt;</div></div>
    </div>
  </div>
  <!-- …其余 boss 卡同结构,全部包在这一个 .raid-wall 内… -->
</div>
```
**属性→图标文件**(扩展名不统一,务必照此):`fire.png water.webp grass.webp electric.webp ice.webp
fighting.png poison.webp ground.webp flying.png psychic.webp bug.png rock.webp ghost.webp dragon.png
dark.webp steel.webp fairy.webp normal.webp`;`一般` = `normal.webp`。counter 招式属性由
`gamemaster` 的 move→type 求得。Keep it readable on mobile.

---

## Common data-analysis mistakes to avoid

These mistakes have been observed in past runs. **Check for each one** during step 9 (self-check).

1. **Wrong link attribution.** Don't attach a generic category guide URL (e.g. a "Spotlight & Raid
   Hours" schedule page) as the Hub link for a Community Day event. Confirm each `links[].url`
   actually covers **this specific event/Pokémon** — open the page (via `fetch.sh url`) and verify
   before attaching. If the page is about a different subject, omit rather than attach.

2. **Stale `highlight:true`.** The `highlight` flag means **boosted shiny odds** (社区日 ~1/25,
   团战日 special rate). Standard raid encounters (传说 ~1/20) have the **base** raid shiny rate —
   they are NOT "boosted". Do not mark regular Raid Hours as `highlight:true`. Only set it for
   Community Day, Raid Day, and events that explicitly announce boosted shiny odds. Note:
   `highlight` now only shows the ✨ icon; the gold border is separately controlled by
   `featured.json` — do not confuse the two.

3. **Inconsistent Mega form IDs.** Apply the Mega base-id rule uniformly across `rotations.json`.
   **Whenever you switch a segment's `id` to the base dex, you MUST also add the `"sprite"` form-image
   override** — otherwise the day-icon regresses from Mega art to the base sprite. The id-match only
   affects segments with a live matching `raid-battles` event (past segments render fine either way),
   but keep them uniform to avoid confusion.

4. **Single-source events.** After writing events.json, scan for events with only 1 link. For each,
   actively search the other sources (Hub via `events-hub`, pokébase via `events-pokebase`, official
   via `events-official`). Major events (Community Day, Fest, anniversaries) almost always have
   coverage in all 4 sources — a single-source major event signals a missed merge opportunity.

5. **Language leakage.** In canonical files and the five `index.html` wrappers, every
   `name`, `pokemon[].name`, `counters[].name`, `cn`, visible ranking phrase and sprite
   `alt` must be 简体中文 (an English machine `heading` remains acceptable). Conversely,
   every visible string in `i18n/en.json` must be English—validation rejects CJK there.
   Verify official proper names in both directions; never copy one locale as fallback.

6. **Fabricating URLs.** Never construct a URL from a pattern (e.g., guessing a Hub article slug from
   an event name). Only emit URLs you have actually seen in a source page or feed. If you cannot find
   a matching article, it's better to have 1 link than a broken link.

7. **LeekDuck-only tunnel vision.** A LeekDuck 404 / omission is **not** proof an event doesn't exist.
   LeekDuck skips many **region- or country-limited** events that Hub's monthly
   roundup, the 官网 news, or `pokemongo.fandom.com` still cover. Before skipping any event as
   "nonexistent", sweep the **searchable / bulk-readable** sources — the LeekDuck feed, the `events-hub`
   / `events-official` / `events-pokebase` bulk files, and `scripts/discover.sh` (which searches LeekDuck
   + Hub + 官网 + Fandom) — opening each lead with `scripts/fetch.sh url`; only drop it if every one comes
   up empty. (Serebii has no search/bulk feed — corroboration via a known URL only, never a sweep target.) **Region /
   local / in-person events are in scope, not noise** — never discard one merely because LeekDuck lacks
   it. (Recording a genuinely-unconfirmable event as a gap in `data/state.json` is still correct — just
   don't reach that conclusion from LeekDuck alone, and never paper over the gap with a fabricated link.)

8. **Internal pipeline details leaking into user-visible text.** Never mention `data/raw/*`
   paths, script names, fetch mechanics, or run bookkeeping in any AI region, `summary`,
   `bonuses`, or `sections` — users see a dashboard, not the pipeline ("上游数据源暂未更新"
   is fine; "`data/raw/raids.json` 仍是旧的" is not). Such notes belong in `data/state.json`.
   Also remember the free-form regions are raw HTML: markdown backticks are **not** rendered,
   they ship to users verbatim.
