# Sub-agent 30 — Ranking Curator

Goal: refresh the human-readable rankings and current recommendations.

Read first: `AGENTS.md` (rules · schemas · validation gate) — isolated sub-agents do
not inherit the coordinator's context.

Write scope:
- Only the contents between these markers in `public/index.html`:
  - `AI:START calendar-notes` / `AI:END calendar-notes`
  - `AI:START rankings-current` / `AI:END rankings-current`
  - `AI:START rankings-attackers` / `AI:END rankings-attackers`
  - `AI:START rankings-defenders` / `AI:END rankings-defenders`
  - `AI:START rankings-raid` / `AI:END rankings-raid`

Inputs:
- `data/raw/tiers-attackers.txt`, `data/raw/tiers-defenders.txt`,
  `data/raw/tiers-pokebase.txt`.
- `data/raw/raids.json`, `data/raw/gamemaster.json`.
- Finalized `public/data/events.json` and `public/data/rotations.json` produced by
  the Calendar and Rotation workstreams for this run, or an explicit coordinator
  handoff containing those exact finalized results. Do not start from previous/stale
  files while those sibling workstreams are still in progress.

Checklist:
1. Preserve every marker, wrapper, `.rank-panel`, and `id="…"` attribute outside the
   marker contents.
2. Use only inert HTML and the whitelisted classes from `AGENTS.md`; no scripts,
   styles, external CSS, or unapproved classes.
3. Parse tiers from the source pages, including per-type 属性榜 from attackers. Do not
   decide rankings yourself.
4. Build `.rank-list` / `.rank-item` rows with `.tier tier-S|tier-A|tier-B|tier-C`,
   sprites, names, and recommended moves.
5. Build `rankings-raid` from current raid bosses and justified counters.
6. Build both free-form regions from **this run's** finalized `events.json` +
   `rotations.json` only (never previous/stale files): `rankings-current` ties today's
   live events and bosses to useful attackers / tanks; `calendar-notes` is a concise
   本月看点 in 简体中文.
7. Never ship empty ranking panels. If tier or raid parsing fails, keep only the
   affected structured panel from last good content and report the problem to State +
   Validator.

Output to the coordinator: edited marker names, source sections parsed, and any panels
kept from last good content.
