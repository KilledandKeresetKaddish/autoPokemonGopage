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
   sprites, names, and recommended moves. **Verify every Pokémon name and move against
   `data/raw/gamemaster.json` (the dex id is embedded in the source artwork URL → confirm
   the species) — never write a Chinese name or move from memory; drop anything you can't
   verify rather than guessing.**
5. Build `rankings-raid` (**当前团战 Counter**) from what's live now — current raid bosses **and any
   active Max/Dynamax battle**. This tab is the **detailed** reference (calendar drawers stay concise):
   render **each boss as a header with a large sprite** (`.raid-block` > `.raid-boss` with a
   `.boss-icon` + 简体中文 name + a `.meta` line of 属性 / 弱点), then a **fuller** counter list in a
   **`.rank-list.mini`** (smaller sprites) below, so the boss reads bigger than its counters. Then a
   **Mega Booster** block stating the mechanic correctly — an **active** Mega gives **+1 糖 when you
   catch a Pokémon sharing that Mega's 属性** (not "evolving yields that species' candy", and unrelated
   to evolving) — and **pairing each live boss to a same-属性 Mega**, rendered as a **detailed
   `.rank-list`** (recommended 超级 sprite + which boss's candy it farms). Build the pairing from this
   run's live bosses; never hard-code a fixed list. **Verify every 属性 / 弱点 against `gamemaster`
   too — label each Mega by the 属性 it *shares* with the boss (that shared type is what grants the
   candy); never copy the boss's own 属性 onto the Mega.**
6. Build both free-form regions from **this run's** finalized `events.json` +
   `rotations.json` only (never previous/stale files): `rankings-current` (本期推荐) is
   **editorial / priority** — which live events to do, bonuses, shiny windows, a directional
   "练哪类攻手" — **not** full counter tables (those live in 当前团战 Counter); `calendar-notes`
   is a concise 本月看点 in 简体中文.
7. Never ship empty ranking panels. If tier or raid parsing fails, keep only the
   affected structured panel from last good content and report the problem to State +
   Validator.

Output to the coordinator: edited marker names, source sections parsed, and any panels
kept from last good content.
