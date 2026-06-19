# CLAUDE.md — programming agent guide

This file is for **code-editing agents** (Claude Code, PR reviewers, feature work).
The **daily content-update agent** reads `AGENTS.md` instead — do not mix the two.

## Repository overview

A self-contained Pokémon GO dashboard (static site, no build step). Served directly
from `public/`.

### Key files

| File | Role |
|---|---|
| `public/index.html` | Single-page app shell. Has `<!-- AI:START -->` / `<!-- AI:END -->` marker regions that the daily agent rewrites; everything outside markers is hand-maintained. |
| `public/app.js` | All rendering logic — calendar grid, drawer, rotations, rankings, world clock. |
| `public/style.css` | Styles. Dark theme, CSS custom properties (`--gold-bright`, `--ink`, etc.). |
| `public/data/events.json` | Event data (daily agent writes this). |
| `public/data/rotations.json` | Weekly boss rotation (daily agent writes this). |
| `public/data/featured.json` | Admin-curated featured event IDs — gold border on calendar. Daily agent maintains on admin's behalf. |
| `public/data/categories.json` | Custom event-type palette registrations. |
| `public/data/meta.json` | `lastUpdated` timestamp shown in header. |
| `public/assets/icons/` | Type and item icons (mixed `.png`/`.webp`). |
| `scripts/` | Shell scripts for the daily agent (`fetch.sh`, `discover.sh`, `validate.sh`, `preflight.sh`, `run-daily.sh`). |
| `data/state.json` | Daily agent bookkeeping (fetch timestamps, notes). |
| `data/raw/` | Cached raw source data (daily agent writes). |
| `AGENTS.md` | Instructions for the daily content-update agent. **Not for you.** |

### Architecture notes

- No framework, no bundler — vanilla JS + CSS.
- Calendar renders from `events.json`; day-number raid icons render from `rotations.json`.
- `highlight: true` in events.json → ✨ icon (shiny boost indicator only).
- `featured.json` → gold border on matching events (admin-controlled, independent of highlight).
- Event detail drawer: `#event-detail` aside, opened by `openDetail()`, closed by X / Escape / click-outside.
- Sprites: PokeAPI (`raw.githubusercontent.com/PokeAPI/sprites/.../<dexId>.png`). Form overrides via `"sprite"` field or Hub DB images.
- `app.js` auto-links all rendered sprites to `db.pokemongohub.net/pokemon/<id>` (via `data-hub` attribute for forms).
- Type icon files have inconsistent extensions — see the map in `AGENTS.md` under "属性→图标文件".

### CSS class vocabulary (for HTML in AI marker regions)

Containers: `.panel` `.panel-head` `.note-grid` `.callout`
Lists: `.rank-list` `.rank-item` `.pill` `.pillrow` `.badge` `.btn`
Pokemon: `.mon-icon` `.mon-row` `.mon` `.shiny` `.tier` (`.tier-S` `.tier-A` `.tier-B` `.tier-C`)
Sprites/icons: `<img class="spr">` `<img class="ico">` `<img class="ico-lg">`
Raid blocks: `.raid-block` `.raid-boss` `.boss-icon` `.raid-mega` `.rank-list.mini`

### Testing

- `scripts/validate.sh` — structural JSON validation + HTML safety checks.
- `scripts/preflight.sh` — semantic checks (orphan raids, rotation/event consistency, chip overflow).
- Both run in `run-daily.sh`; either failing rolls back the daily agent's changes.
