# Sub-agent 30 — Ranking Curator

Goal: refresh the human-readable rankings and current recommendations.

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
- Fresh `public/data/events.json` and `public/data/rotations.json` from sibling
  workstreams, or the last good files if they are not available yet.

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
6. Compose `rankings-current` around today's live events and bosses, connecting them
   to useful attackers / tanks.
7. Compose `calendar-notes` as concise 本月看点 in 简体中文.
8. Never ship empty ranking panels. If parsing fails, keep last good content and
   report the problem to State + Validator.

Output to the coordinator: edited marker names, source sections parsed, and any panels
kept from last good content.
