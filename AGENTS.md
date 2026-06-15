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
1. **Calendar** (`#view-calendar`) — month grid, data-driven from `public/data/events.json`.
2. **Rankings** (`#view-rankings`) — Max attackers / Max defenders / raid counters, plus
   a "本期推荐" panel tied to what's live right now.
3. **Tracker** (`#view-tracker`) — the user's personal daily checkboxes. **Not your
   concern. Never read or touch it.**

## What you MAY edit — and nothing else
- `public/data/events.json` — the normalized events array the calendar renders.
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
| `tiers-attackers` | Hub "Max Attackers Tier List" page | older than ~3 days | `data/raw/tiers-attackers.txt` |
| `tiers-defenders` | Hub "Max Defenders Tier List" page | older than ~3 days | `data/raw/tiers-defenders.txt` |

> Hub sits behind a Cloudflare challenge, so `fetch.sh` pulls these through a
> solver (Jina Reader by default) — the saved `.txt` is the rendered page content
> (markdown or HTML). Parse the tiers out of whatever form it's in.

**Sprites** need no fetch — build image URLs directly from a Pokémon's national-dex id:
`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/<dexId>.png`

> If a fetch fails or a page comes back empty/unparyable (a source changed, or Hub is
> unreachable), **keep the last good content in place**, record the problem in
> `data/state.json`, and still pass validation. Never ship empty rankings.

---

## Daily procedure
1. `scripts/fetch.sh list` + read `data/state.json` → decide what is stale.
2. Fetch only what's needed, e.g. `scripts/fetch.sh events raids tiers-attackers`.
3. Read the raw files; adapt to their **current** structure.
4. **Calendar** → rewrite `public/data/events.json` (normalize ScrapedDuck → schema
   below). Keep the current and next month; drop long-past events.
5. **Rankings** → rewrite the regions in `index.html`:
   - `rankings-attackers` / `rankings-defenders` → parse the tier tables from
     `data/raw/tiers-*.txt` (tiers like S/A/B, Pokémon, recommended moves). Render as
     `.rank-list` / `.rank-item` with a `.tier tier-S|tier-A|…` badge and a sprite.
     (The Jina output is markdown: `## S Tier` / `## A Tier` … section headers, each
     followed by a table of Pokémon. A Pokémon's national-dex id is embedded in its
     artwork image URL, e.g. `…/detail/861_gmax.png` → id 861. Use that id for the
     PokeAPI sprite — strip form suffixes like `_gmax`. **Adapt if the layout changes.**)
   - `rankings-raid` → from current bosses in `data/raw/raids.json`, list each boss with
     a few top counters (justify with `gamemaster` stats/types — don't invent numbers).
   - `rankings-current` (**highest value**) → synthesize what matters *today*: ongoing
     events (from events.json) + current raid bosses, and surface the best attackers /
     tanks to use for them (e.g. a Max/Dynamax event → point to the relevant Max picks).
   - `calendar-notes` → a short 本月看点 summary (optional).
6. Set `public/data/meta.json` `lastUpdated` to now (ISO 8601); record per-source fetch
   times/notes in `data/state.json`.
7. Run `scripts/validate.sh`. Fix whatever it reports until it passes.

---

## Schemas

`public/data/events.json` — array the calendar renders:
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
  "bonuses": ["双倍星尘", "..."],
  "pokemon": [{ "name": "皮卡丘", "id": 25, "shiny": true }]
}
```
- `start`/`end` ISO 8601; `end` may equal `start`. `bonuses`/`pokemon` optional.
- `link` must point to the event's detail page so users can click through from the calendar.

`public/data/meta.json`:
```json
{ "lastUpdated": "2026-06-15T08:00:00Z", "note": "optional short status" }
```

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
