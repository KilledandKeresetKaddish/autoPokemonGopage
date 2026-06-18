# AGENTS.md — pogo-agent daily operator guide

This repository is a **self-contained Pokémon GO dashboard**. A coding-agent CLI
runs **once per day** (via `scripts/run-daily.sh` from cron) with this directory as
its working directory. Each run you refresh the site's content from trustworthy
sources and write it into the files listed under **"What you may edit"**. The wrapper
then runs `scripts/validate.sh` and either publishes your changes (git commit) or
**rolls them back**.

You are the **brain**. The deterministic scripts only download bytes — *you* decide
what to fetch, whether it's even needed today, and how to interpret it. Third-party
formats change: never assume fixed field positions; **re-read and adapt every run.**

UI text shown to users must be **Simplified Chinese (简体中文)**.

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

---

## The site (2 content sections + owner placeholders)
1. **Calendar** (`#view-calendar`) — month grid **+ a 长期活动 band** (long-running events
   pulled out of the grid) **+ a 本月 Weekly Rotations** section. Data-driven from
   `public/data/events.json` and `public/data/rotations.json`: short headline events live in
   the grid; season/pass/league/multi-week events render in the band; the 5★/Mega/Max weekly
   boss rotation renders from `rotations.json`.
2. **Rankings** (`#view-rankings`) — Max attackers / Max defenders / raid counters, plus
   a "本期推荐" panel tied to what's live right now.
The other two views — **世界时钟** (`#view-clock`) and **实用链接** (`#view-links`) — are
**owner-maintained placeholders** (static, no AI markers). **Not your concern — never read
or touch them.**

## What you MAY edit — and nothing else
- `public/data/events.json` — the normalized events array the calendar + 长期活动 band render.
- `public/data/rotations.json` — the current month's 5★/Mega/Max weekly boss rotation.
- `public/data/categories.json` — register a NEW event `type` (palette key + 简体中文 label + kind)
  when a source introduces one the built-ins don't cover. **Palette KEY only — never a raw colour.**
- `public/data/meta.json` — set `lastUpdated` (ISO 8601); the header shows it.
- The AI regions inside `public/index.html`, **strictly between** these marker pairs:
  - `<!-- AI:START calendar-notes -->` … `<!-- AI:END calendar-notes -->`
  - `<!-- AI:START rankings-current -->` … `<!-- AI:END rankings-current -->`
  - `<!-- AI:START rankings-attackers -->` … `<!-- AI:END rankings-attackers -->`
  - `<!-- AI:START rankings-defenders -->` … `<!-- AI:END rankings-defenders -->`
  - `<!-- AI:START rankings-raid -->` … `<!-- AI:END rankings-raid -->`
- `data/state.json` — your own bookkeeping (last-fetch times, source hashes, notes).

## HARD RULES (validation rejects the run if broken)
- **NEVER** edit `public/app.js`, `public/style.css`, `scripts/*`, or anything in
  `public/index.html` **outside** the AI markers. Keep every `AI:START`/`AI:END`
  marker present and balanced, and keep the `.rank-panel` wrappers and all `id="…"`
  attributes intact.
- The HTML you write must be **inert**: no `<script>`, no external CSS/JS.
- Keep `public/data/*.json` valid JSON in the schemas below.
- **Fetch only via `scripts/fetch.sh` / `scripts/discover.sh`**: the named sources below, ad-hoc
  detail pages on the allowlisted domains via `scripts/fetch.sh url <URL>`, and candidate-URL
  search via `scripts/discover.sh "<keywords>"` (see *Looking things up*). Never fetch
  off-allowlist domains.

---

## Data sources — fetch via `scripts/fetch.sh <name>`
Start by running `scripts/fetch.sh list` and reading `data/state.json` to see what is
already cached and how old it is. **Decide what to refresh by age — do not blindly
refetch everything.** Then read the files in `data/raw/`.

| source | what | refresh when | output |
|---|---|---|---|
| `events` | events/community days/spotlights (ScrapedDuck → LeekDuck) | older than ~1 day | `data/raw/events.json` |
| `raids` | current raid bosses | older than ~1 day | `data/raw/raids.json` |
| `eggs` / `research` | egg pools / field research | when relevant | `data/raw/*.json` |
| `gamemaster` | Pokémon stats, types, moves (PvPoke) | older than ~7 days | `data/raw/gamemaster.json` |
| `tiers-attackers` | Hub "Max Attackers Tier List" page (**含属性榜**, per-type picks) | older than ~3 days | `data/raw/tiers-attackers.txt` |
| `tiers-defenders` | Hub "Max Defenders Tier List" page | older than ~3 days | `data/raw/tiers-defenders.txt` |
| `tiers-pokebase` | pokébase tier lists (cross-check / second opinion) | older than ~3 days | `data/raw/tiers-pokebase.txt` |
| `events-hub` | Hub events hub + monthly article (events **and** weekly rotations) | older than ~1 day | `data/raw/events-hub.txt` |
| `events-pokebase` | pokébase events list | older than ~1 day | `data/raw/events-pokebase.txt` |
| `events-official` | pokemongo.com official news/events | older than ~1 day | `data/raw/events-official.txt` |

> The Hub tier/event pages, pokébase, and the official site sit behind a Cloudflare
> challenge or heavy JS, so `fetch.sh` pulls them through a solver (Jina Reader by
> default) — the saved `.txt` is the rendered page content (markdown or HTML). Parse
> whatever form it's in; **never assume fixed positions — re-read every run.**
>
> **Source priority.** `events` (ScrapedDuck → LeekDuck, clean JSON) is the authoritative
> backbone for the calendar. Hub / pokébase / official **enrich and corroborate**: extra
> source links, Pokémon details, the weekly rotation schedule, date sanity-checks. If a
> Jina source is flaky or empty, still build a complete calendar from `events` + Hub.

**Sprites** need no fetch — build image URLs directly from a Pokémon's national-dex id:
`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/<dexId>.png`

> If a fetch fails or a page comes back empty/unparyable (a source changed, or Hub is
> unreachable), **keep the last good content in place**, record the problem in
> `data/state.json`, and still pass validation. Never ship empty rankings.

### Looking things up (ad-hoc, allowlisted)
The named sources above are the backbone. When you need a **specific detail page** the bulk feeds
don't cover — an individual LeekDuck event, a Hub article, a pokébase Pokémon/event page, an
official news post — pull it on demand and read it:
```
scripts/fetch.sh url https://leekduck.com/events/<slug>/
scripts/fetch.sh url https://pokemongohub.net/post/<...>
```
It prints the page to stdout (JS/Cloudflare hosts go through the solver; raw file/API hosts via
plain curl). **Allowed hosts:** `leekduck.com · pokemongohub.net · pokebase.app · pokemongo.com · dialgadex.com ·
raw.githubusercontent.com · pvpoke.com · pokeapi.co` (e.g. `dialgadex.com` for best-attacker-by-type
cross-checks). Off-allowlist URLs are refused. Stay
**primarily on the named sources** — use `url` to enrich / corroborate / chase a detail, not to crawl.

**Don't know the URL? Discover it — don't guess.** The feeds give you every LeekDuck link and the
Hub *index*, but not a specific Hub **guide/article** slug (e.g. a per-boss raid guide). When you
need a page whose URL you don't already have, search the trusted sources first:
```
scripts/discover.sh "mega scizor raid guide"
scripts/discover.sh "10th anniversary party"
```
It matches LeekDuck via the cached `events` feed and searches Pokémon GO Hub (its on-site search,
through the same Jina solver), printing `SOURCE <tab> TITLE <tab> URL` candidates (also saved under
`data/raw/discovery/`). **Candidates are leads, not facts:** open each promising one with
`scripts/fetch.sh url <URL>`, confirm it is the *exact* same event/Pokémon (right boss, right
month), and only then add it to `links[]`. If nothing fits, record the gap in `data/state.json` —
never invent a link.

---

## Daily procedure
1. `scripts/fetch.sh list` + read `data/state.json` → decide what is stale.
2. Fetch only what's needed, e.g.
   `scripts/fetch.sh events raids events-hub events-pokebase tiers-attackers`.
3. Read the raw files; adapt to their **current** structure.
4. **Calendar** → rewrite `public/data/events.json` (schema below). Backbone = `events`
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
     sources and nothing fits. Keep `link` = the primary one.
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
   - **Flag long-running events.** Set `longTerm:true` on season / GO Pass / GO Battle League and
     anything spanning more than ~2 weeks — they render in the 长期活动 band, not the day grid
     (this is what keeps headline short events visible). `longTerm:false` forces a borderline
     event back onto the grid. (`display:"banner"|"bar"` are equivalent overrides.)
   - **Flag focus / shiny-boost events.** Set `highlight:true` on 社区日, 团战日, and any event with
     **boosted shiny odds** → ✨ + gold ring on the calendar. Also set `pokemon[].shiny:true` for the
     shiny-available mons and add a `bonuses[]` line like "✨ 闪光概率提升" so the detail drawer shows it.
   - **New event types.** If a source introduces a `type` that isn't styled yet (it would otherwise
     fall back to a generic grey marker), register it in `public/data/categories.json` with a palette
     key + 简体中文 label + kind (see schema). Assign the family colour that fits — you can't pick a hex.
   - **Retention.** Keep the **current month through the end of next month**; **drop events that
     ended before the current month started**. Use a **stable `id`** (derived deterministically
     from a source slug) so re-runs map the same event to the same row and can never accumulate
     duplicates.
5. **Rotations** → rewrite `public/data/rotations.json` (schema below): the **current month's**
   5★ / Mega / Max weekly boss rotation, parsed from the Hub monthly article and corroborated
   with `data/raw/raids.json`. Dex id per boss for the sprite; dates `YYYY-MM-DD`.
   **Parse the bosses — never invent them.**
6. **Rankings** → rewrite the regions in `index.html`:
   - `rankings-attackers` / `rankings-defenders` → parse the tier tables from
     `data/raw/tiers-*.txt` (S/A/B…, Pokémon, recommended moves); cross-check with
     `tiers-pokebase`. Surface the attackers page's **per-type 属性榜** (best pick per type).
     Render as `.rank-list` / `.rank-item` with a `.tier tier-S|tier-A|…` badge and a sprite.
     (Jina output is markdown: `## S Tier` … headers + tables. A Pokémon's national-dex id is
     embedded in its artwork URL, e.g. `…/detail/861_gmax.png` → id 861; strip suffixes like
     `_gmax`. **Adapt if the layout changes. Parse the lists — do not decide rankings yourself.**)
   - `rankings-raid` (**当前团战 Counter**) → counters for what's **live right now**: current raid
     bosses from `data/raw/raids.json` **and any active Max/Dynamax battle**. This tab is the
     **detailed** reference (the calendar drawers stay concise). Render **each boss as a header with a
     large sprite** (`.raid-block` > `.raid-boss` with a `.boss-icon` + 简体中文 name + a `.meta` line
     of its 属性 / 弱点), then a **fuller** counter list in a **`.rank-list.mini`** (smaller sprites)
     below — so the boss reads bigger than its counters. Justify counters with `gamemaster` types;
     don't invent numbers.
   - Then a **Mega Booster** block. Get the mechanic right: an **active** Mega gives **+1 糖 when you
     catch a Pokémon sharing that Mega's 属性** (chance of extra / XL) — it is **not** "evolving yields
     that species' candy" and has nothing to do with the act of evolving. **Pair each live boss to a
     same-属性 Mega** for farming that boss's candy (boss 属性 → a Mega of the same 属性), and render the
     pairing as a **detailed `.rank-list`** (the recommended 超级 sprite + which boss's candy it farms),
     not a one-liner. Build the pairing from whatever bosses are live this run — never hard-code a
     fixed list. **Verify each 属性 / 弱点 against `gamemaster`; label the Mega by the 属性 it *shares*
     with the boss (that shared type drives the candy) — never paste the boss's own 属性 onto the Mega.**
   - `rankings-current` (本期推荐, **free-form, highest value**) → **editorial / priority**, not a
     counter dump: which live events to do this period (社区日/团战日/Max周一/聚焦), bonuses, shiny
     windows, and a directional "练哪类攻手". Full counter tables belong in 当前团战 Counter — point
     there, don't duplicate them (see *Free-form synthesis* below).
   - `calendar-notes` (**free-form**) → a short 本月看点 (see *Free-form synthesis*).
7. Set `public/data/meta.json` `lastUpdated` to now (ISO 8601); record per-source fetch
   times/notes in `data/state.json` (a fixed object keyed by source — **not** a growing log).
8. **Self-check before validating:** one row per real event (no duplicate `id`s), `links[]`
   aggregated, no event ended >3 months ago, long events flagged, rotations parsed not invented,
   **every 简体中文 name/move verified against `gamemaster` (no hallucinated or garbled names).**
9. Run `scripts/validate.sh`. Fix what it reports until it passes. (It hard-rejects duplicate
   ids, >250 events, and events ended >100 days ago — so prune and dedup.)

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
  "sections": [{ "title": "付费内容", "items": [":ticket: 票务 4.99 美元", "..."] }],
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
- `counters`: best raid/团战 counters (`id` for the sprite + 简体中文 `name` + optional `fast`/`charged`
  moves) → rendered as a collapsible "团战 Counter" block. Fill for raid / mega / raid-day events from the
  Hub raid guide or `db.pokemongohub.net`, justified by `gamemaster` — **don't invent**.
- `sections`: **free-form** collapsible blocks `[{ "title": "...", "items": ["..."] }]` — **you decide
  per event** what's worth surfacing (付费/票务、限时调查步骤、栖息地时段、Field Research 任务、奖励清单…).
  Titles and contents are yours to choose; 付费内容 is just one example. Use them to bring the useful
  detail inline instead of forcing users out to the source link.
- **Icons:** the repo ships icons in `public/assets/icons/`, **always at a locked size** via the `ico`
  (inline) / `ico-lg` (standalone) class. In `bonuses`/`sections` text use a `:token:` (e.g.
  `:stardust: 捕捉星尘 ×3`, `:water: 水属性`); in the free-form regions write
  `<img class="ico" src="assets/icons/<file>">`. Tokens — types: `bug dark dragon electric fairy fighting
  fire flying ghost grass ground ice poison psychic rock steel water`; items: `candy xl-candy rare-candy
  stardust xp lure incense incubator golden-razz silver-berry pokeball pokestop raid spawn rocket trading`.
  Unknown tokens fall back to `<token>.png`; missing files hide. Use where it adds clarity (e.g. a type
  icon next to a counter, an item icon next to a bonus).
- `link` (single) is kept for back-compat; prefer `links[]` to point at **every** source for the event.
- `longTerm:true` → renders in the 长期活动 band instead of the grid (auto for season/pass/league
  and spans >~2 weeks; set `false` to force back onto the grid).
- `highlight:true` → ✨ + gold ring on the calendar bar/chip. Set it for **focus events**: 社区日
  (Community Day), 团战日 (Raid Day), and any event with **boosted shiny odds**. Put the shiny detail
  in `pokemon[].shiny` (✨ on the sprite) and add a `bonuses[]` line like "✨ 闪光概率提升".

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
    { "key": "max",  "label": "Max 团战", "color": "#bd7f97", "segments": [ "…" ] }
  ]
}
```
- The three tracks 5★ / Mega / Max. `cn` = displayed name; `pokemon[]` may hold >1 boss (dual/triple
  rotations — they **cycle** inside one day-number icon). `start`/`end` = `YYYY-MM-DD`.
- **5★ and Mega weekly bosses render as small icons next to each day's number** (the grid no longer
  draws weekly-raid bars). So keep rotations.json **complete for the whole month**, or those raids
  vanish from the grid. `color` drives both the rotation section and the day-icon ring — 5★ = gold
  `#d8b25f`, Mega = purple `#9c7bb0` (Max keeps its own; Max is not a day icon). `tag` (≤2 chars,
  optional) is the icon's hover badge (default 5★ / M).
- **A Mega/5★ day-icon links to its raid event by *dex id* — keep the id consistent.** Clicking an
  icon opens the drawer of the matching `events.json` raid (its counters / links / summary). The
  matcher compares `pokemon[].id`, so a rotation segment **must use the SAME id as that boss's
  `events.json` raid entry** — i.e. the **BASE national-dex id** (Mega 巨钳螳螂 → `212`, *not* the
  mega-form id `10046`), with the mega look supplied via `"sprite"`. Put a mega-form id here and the
  icon opens a **bare, link-less drawer** (it can't find its event — this is a real bug, not cosmetic).

`public/data/meta.json`:
```json
{ "lastUpdated": "2026-06-15T08:00:00Z", "note": "optional short status" }
```

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
Use **only** these whitelisted, theme-correct classes (no inline colors, no `<style>`, no `<script>`):
- containers: `.panel` / `.panel-head`, `.note-grid` (auto-responsive columns), `.callout` (highlight box)
- lists/atoms: `.rank-list` / `.rank-item`, `.pill` / `.pillrow`, `.badge`, `.btn` / `.btn-primary`, `.muted`
- Pokémon/tiers: `.mon-icon`, `.mon-row` / `.mon` / `.shiny`, `.tier` + `.tier-S|tier-A|tier-B|tier-C`
- sprites/icons: `<img class="spr">` or `class="mon-icon"` (PokeAPI dex-id URL); `<img class="ico">` /
  `class="ico-lg"` for the local resource icons in `assets/icons/` (size locked).
- current-raid blocks (structured `rankings-raid` only): `.raid-block` > `.raid-boss` (header) with a
  big `<img class="boss-icon">`, and `.rank-list.mini` for the compact counter rows beneath it.

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
当前团战 Counter — boss 头(大图)+ 紧凑 counter 列表(小图)。占位符按本轮实际 boss 填:
```html
<div class="raid-block">
  <div class="raid-boss">
    <img class="boss-icon" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/<bossDexId>.png" alt="<boss 简体中文名>">
    <div><span class="badge">&lt;档次&gt;</span><strong>&lt;boss 简体中文名&gt;</strong><div class="meta">&lt;属性&gt; · 弱 &lt;弱点&gt;</div></div>
  </div>
  <div class="rank-list mini">
    <div class="rank-item"><img class="mon-icon" src="…/<counterDexId>.png" alt="<counter 名>"><div><strong>&lt;counter 名&gt;</strong><div class="meta">&lt;fast&gt; / &lt;charged&gt;</div></div></div>
  </div>
</div>
```
Keep it readable on mobile.
