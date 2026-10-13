# CLAUDE.md — programming agent guide

This file is for **code-editing agents** (Claude Code, PR reviewers, feature work).
The **daily content-update agent** reads `AGENTS.md` instead — do not mix the two.

> **Edit scope — by role, not by file.** `AGENTS.md`'s "never edit `scripts/*` / `app.js` / `style.css` /
> `index.html` outside markers" rules bind the **daily content-update agent** only — they stop an automated
> daily run from changing the program. As a coding/maintainer agent that *is* your job: you edit the app
> code, styles, validation scripts (`scripts/preflight.sh` etc.), and HTML structure deliberately and on
> purpose. Just keep the daily agent's data contracts and the `AI:START/END` markers intact so its runs
> still work.

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
| `public/data/locations.json` | Spot Atlas stable facts: one raw `name`, coordinates, location IANA timezone and review metadata. Runtime offsets/targets/map URLs are derived, never stored. Daily-agent edits require an explicit operator note. |
| `public/data/i18n/ui.json` | Owner-maintained zh-CN/en static UI dictionary; checksum-protected. |
| `public/data/i18n/en.json` | Daily-agent English text overlay keyed by canonical event IDs/rotation track order, plus five localized rich-region HTML strings. Beyond required lookup keys, it contains no duplicated structural IDs, dates, links, or sprites. |
| `public/data/mega.json` | Mega/Primal roster for the 「超级进化」view. Agent-editable; the per-Pokémon fields that drive mechanics are `initialCost` (every cost/time number derives from it) and the optional `superMax` boolean (gates the Super-Max planner target + badge). |
| `public/assets/icons/` | Type and item icons (mixed `.png`/`.webp`). |
| `scripts/` | Daily shell scripts plus Node helpers (`fetch.sh`, `discover.sh`, `discovery-report.js`, `daily-candidates.js`, `validate.sh`, `preflight.sh`, `test-spot-atlas-time.js`, `run-daily.sh`, `publish.sh`). `discovery-report.js` is pure parsing/report formatting; network/cache ownership stays in the shell scripts. **Editing anything in `scripts/`, `AGENTS.md`, `tasks/*.md`, `CLAUDE.md`, `.gitignore`, `app.js`, `style.css`, or the static UI dictionary requires regenerating the integrity file in the same commit** (`validate.sh` hash-checks them): `sha256sum .gitignore public/app.js public/style.css public/data/i18n/ui.json scripts/*.sh scripts/*.js scripts/*.py AGENTS.md CLAUDE.md tasks/daily-update.md tasks/spot-atlas.md tasks/subagents/*.md tasks/reference/*.md > scripts/protected.sha256`. Also commit maintainer work before a daily run — `run-daily.sh` refuses a dirty tree (its rollback would destroy uncommitted changes). |
| `data/state.json` | Daily agent bookkeeping (fetch timestamps, notes). |
| `data/raw/` | Cached raw source data (daily agent writes). |
| `AGENTS.md` | Instructions for the daily content-update agent. **Not for you.** |

### Architecture notes

- No framework, no bundler — vanilla JS + CSS. Daily execution requires Linux/readable `/proc`, Bash/GNU coreutils, Git, curl, jq, Node.js with Intl/IANA data, Python 3 (stdlib only) and flock. The wrapper checks supervisor/gate prerequisites before invoking an agent; no browser-side runtime package was added.
- Bilingual model: canonical JSON + the Chinese AI wrappers carry shared facts/default zh-CN text; `i18n/en.json` overlays text only. The header toggle persists `pogo-locale`, updates `<html lang>`, and rerenders every view. `validate.sh` enforces event/rotation/nested-array parity and safe non-CJK English rich HTML.
- Calendar renders from `events.json`; day-number raid icons render from `rotations.json`. On phones, one bounded per-day raid trigger opens a full-size track chooser so 5★/Mega/Max badges cannot overlap adjacent dates.
- Event `timing` (`docs/event-timing.md`) is the only reminder-boundary contract; calendar `parseDay()`/legacy `start`/`end` date prefixes continue to drive grid layout. `resolveEventTiming(event, now, viewerTimeZone)` is pure and Node-exported from `public/app.js`; reuse Spot Atlas IANA/DST helpers but do not change Spot Atlas clocks or add reminder UI as part of this contract. The same `validateEventTiming` function powers `scripts/check-event-timing.js` from both preflight and validate. New canonical event rows must include timing; English overlay never duplicates structural facts. See `scripts/test-event-timing.js` for fixed UTC+14/UTC−12, DST, partial and negative fixtures.
- Spot Atlas (`#view-spots`) loads `locations.json`. `detectBrowserTimeZone()` resolves the viewer's IANA zone with an explicit UTC fallback; `nextLocalScheduleInstant()` converts each location's Tuesday 20:00 wall clock to an instant; `formatTargetForZone()` formats that same instant for a caller-supplied zone. Keep these helpers dependency-free and Node-exported because `scripts/test-spot-atlas-time.js` imports the production implementation. Location `name`, `note` and coordinates never use i18n.
- Personal reminders (`docs/event-reminders.md`) are browser-only, per-event versioned `pogo-event-reminders:v1:<encoded canonical ID>` keys, separate from TODO/admin featured/shiny flags. Node-exported store, note saver and single boundary scheduler reuse task-3 time helpers; successful canonical loads alone update snapshots. Preserve plain-text notes, incarnation guards and multi-tab per-key merge; never write personal flags/notes into daily JSON or state. Desktop sticky / mobile in-flow expandable panel and every mapped calendar copy share the same derived aurora class. Runtime remains in checksum-protected `app.js` (no extra scripts/build dependencies).
- `highlight: true` in events.json → ✨ icon (shiny boost indicator only).
- `featured.json` → gold border on matching events (admin-controlled, independent of highlight).
- Event detail drawer: `#event-detail` aside, opened by `openDetail()`, closed by X / Escape / click-outside.
- Sprites: PokeAPI (`raw.githubusercontent.com/PokeAPI/sprites/.../<dexId>.png`). Form overrides via `"sprite"` field or Hub DB images.
- `app.js` auto-links all rendered sprites to `db.pokemongohub.net/pokemon/<id>` (via `data-hub` attribute for forms).
- Type icon files have inconsistent extensions — see the map in `AGENTS.md` under "属性→图标文件".
- Mega reference view (`#view-mega`, owner-maintained shell like `#view-todo`) is JS-filled by `renderMega` / `renderMegaDetail` / `setupMega` from `mega.json`. Tables 1–3 (per-level energy `MEGA_ENERGY`, generic bonuses `MEGA_LEVEL_BONUSES`, instant level-up prices `MEGA_LEVELUP` — Bulbapedia "Mega Level Costs") are **constants in `app.js`** keyed off `initialCost`, as are the rest periods/level thresholds (`MEGA_REST`/`MEGA_NEED`) feeding the 升级规划器 (`megaPlanTo`/`megaPlanHtml`, module state `megaPlanN`) — the daily agent adds unique roster rows and may complete/correct existing fields from verified sources (including null initialCost and officially announced superMax), never the mechanics. Identity stays stable; unsupported values remain developer work, not a reason to relax gates. `mega.json` is validated in `validate.sh` (step 4e).

### CSS class vocabulary (for HTML in AI marker regions)

Containers: `.panel` `.panel-head` `.note-grid` `.callout`
Lists: `.rank-list` `.rank-item` `.pill` `.pillrow` `.badge` `.btn` `.meta` `.muted`
Pokemon: `.mon-icon` `.mon-row` `.mon` `.shiny` `.tier` (`.tier-S` `.tier-A` `.tier-B` `.tier-C`)
Sprites/icons: `<img class="spr">` `<img class="ico">` `<img class="ico-lg">`
Raid blocks: `.raid-wall` `.raid-block` `.raid-boss` `.boss-icon` `.binfo` `.btop` `.raid-mega` `.rank-list.mini`

### Testing

- `scripts/validate.sh` — structural JSON validation + bilingual overlay parity + HTML safety checks + Spot Atlas schema/timezone tests.
- `scripts/preflight.sh` — semantic checks (orphan raids, rotation/event consistency, chip overflow, Spot Atlas names/IANA zones).
- `node scripts/test-event-timing.js` — deterministic production-helper fixtures and CLI-gate checks for global/local, regional/DST, offsets and uncertain boundaries.
- `node scripts/test-event-reminders.js` — deterministic full state transitions, task-3 ±1ms fixtures, authority withdrawal/retention, stale-tab protection, merge/expiry/autosave/IME/storage/migration and single scheduler. Optional sandbox-only Chromium: `PLAYWRIGHT_MODULE=/workspace/.pi-tmp/browser-tools/node_modules/playwright-core node scripts/test-event-reminders-browser.js`; see `docs/event-reminders.md` for setup (no runtime dependency/network publish).
- `node scripts/test-spot-atlas-time.js` — deterministic production-helper fixtures for Shanghai/Toronto/London, DST, half-hour offsets, exact-boundary/+1ms behavior and UTC fallback.
- `bash scripts/test-daily-reuse.sh` — offline fetch/discover/cache fixtures (it invokes `test-daily-candidates.js`); `bash scripts/test-run-daily.sh` covers mock Pi deadlines/signals/process groups, telemetry, scope, and recovery. Daily logs under ignored `logs/runs/<run-id>/` distinguish lastAttempt from lastSuccess; tracked state contains agent content decisions only.
- `run-daily.sh` runs preflight/validate; either failing rolls back the daily agent's changes.
