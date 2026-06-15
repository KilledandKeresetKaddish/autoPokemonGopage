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

---

## The site (3 sections)
1. **Calendar** (`#view-calendar`) — month grid **+ a 长期活动 band** (long-running events
   pulled out of the grid) **+ a 本月 Weekly Rotations** section. Data-driven from
   `public/data/events.json` and `public/data/rotations.json`: short headline events live in
   the grid; season/pass/league/multi-week events render in the band; the 5★/Mega/Max weekly
   boss rotation renders from `rotations.json`.
2. **Rankings** (`#view-rankings`) — Max attackers / Max defenders / raid counters, plus
   a "本期推荐" panel tied to what's live right now.
3. **Tracker** (`#view-tracker`) — the user's personal daily checkboxes. **Not your
   concern. Never read or touch it.**

## What you MAY edit — and nothing else
- `public/data/events.json` — the normalized events array the calendar + 长期活动 band render.
- `public/data/rotations.json` — the current month's 5★/Mega/Max weekly boss rotation.
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
- **Do not fetch from anywhere except the sources below.**

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
   - **Aggregate links.** Collect each source's URL for that event into `links[]` with a short
     label (`LeekDuck` / `Hub` / `Pokébase` / `官方`). Keep `link` = the primary one.
   - **Populate Pokémon & bonuses.** Fill `pokemon[]` (dex id + 简体中文 name + `shiny`) and
     `bonuses[]` from the articles — so the calendar isn't empty and the detail drawer is useful.
   - **Flag long-running events.** Set `longTerm:true` on season / GO Pass / GO Battle League and
     anything spanning more than ~2 weeks — they render in the 长期活动 band, not the day grid
     (this is what keeps headline short events visible). `longTerm:false` forces a borderline
     event back onto the grid. (`display:"banner"|"bar"` are equivalent overrides.)
   - **Flag focus / shiny-boost events.** Set `highlight:true` on 社区日, 团战日, and any event with
     **boosted shiny odds** → ✨ + gold ring on the calendar. Also set `pokemon[].shiny:true` for the
     shiny-available mons and add a `bonuses[]` line like "✨ 闪光概率提升" so the detail drawer shows it.
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
   - `rankings-raid` → from current bosses in `data/raw/raids.json`, list each boss with a few
     top counters (justify with `gamemaster` stats/types — don't invent numbers).
   - `rankings-current` (**free-form, highest value**) → synthesize what matters *today*
     (see *Free-form synthesis* below).
   - `calendar-notes` (**free-form**) → a short 本月看点 (see *Free-form synthesis*).
7. Set `public/data/meta.json` `lastUpdated` to now (ISO 8601); record per-source fetch
   times/notes in `data/state.json` (a fixed object keyed by source — **not** a growing log).
8. **Self-check before validating:** one row per real event (no duplicate `id`s), `links[]`
   aggregated, no event ended >3 months ago, long events flagged, rotations parsed not invented.
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
  "longTerm": false,
  "highlight": false
}
```
- `start`/`end` ISO 8601; `end` may equal `start`. `bonuses`/`pokemon`/`links`/`longTerm`/`highlight` optional.
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
    { "key": "5star", "label": "5★ 团战", "color": "#b16a5c",
      "segments": [
        { "name": "Zekrom", "cn": "捷克罗姆",
          "pokemon": [{ "id": 644, "name": "捷克罗姆" }],
          "start": "2026-06-10", "end": "2026-06-16" }
      ] },
    { "key": "mega", "label": "超级团战", "color": "#9c7bb0", "segments": [ "…" ] },
    { "key": "max",  "label": "Max 团战", "color": "#bd7f97", "segments": [ "…" ] }
  ]
}
```
- The three tracks 5★ / Mega / Max. `cn` = displayed name; `pokemon[]` may hold >1 boss (dual
  rotations). `start`/`end` = `YYYY-MM-DD`. Colors align with the calendar palette.

`public/data/meta.json`:
```json
{ "lastUpdated": "2026-06-15T08:00:00Z", "note": "optional short status" }
```

## Free-form synthesis (your creative space)
`calendar-notes` (本月看点) and `rankings-current` (本期推荐) are **free-form inert-HTML
canvases** — compose them freshly each run with judgment. The other regions
(`rankings-attackers/defenders/raid`) stay structured: parse the sources, don't free-style.
Use **only** these whitelisted, theme-correct classes (no inline colors, no `<style>`, no `<script>`):
- containers: `.panel` / `.panel-head`, `.note-grid` (auto-responsive columns), `.callout` (highlight box)
- lists/atoms: `.rank-list` / `.rank-item`, `.pill` / `.pillrow`, `.badge`, `.btn` / `.btn-primary`, `.muted`
- Pokémon/tiers: `.mon-icon`, `.mon-row` / `.mon` / `.shiny`, `.tier` + `.tier-S|tier-A|tier-B|tier-C`
- sprites: `<img class="spr">` (or `class="mon-icon"`) with the PokeAPI dex-id URL above.

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
Keep it readable on mobile.
