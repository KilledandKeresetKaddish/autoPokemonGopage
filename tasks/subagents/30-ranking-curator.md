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
   - **Sort bosses by tier, highest first** (传说/5★ → 超级/Mega → 3★ → 1★ → 暗影 → Max).
   - Render **each boss as a header with a large sprite** (`.raid-block` > `.raid-boss` with a
     `.boss-icon` + 简体中文 name + `.meta`), then a **fuller** counter list in a **`.rank-list.mini`**
     below, so the boss reads bigger than its counters.
   - **属性用图标,不用文字:** boss `.meta` 的 属性 / 弱点 用 `<img class="ico" src="assets/icons/<type>.<ext>">`,
     并在每个 counter 的招式文字前加该招式的 **move 属性** 图标(move→type 取自 `gamemaster`)。扩展名不统一,
     按 `AGENTS.md` *Ranking HTML pattern* 的「属性→图标文件」表;`一般`/normal 无图标 → 保留文字。
   - **Mega Booster = 内联在每个 boss 右侧,不再是底部独立列表。** 机制:**激活**某超级进化时,捕捉与其
     **共享属性**的宝可梦 +1 糖(含 XL 机会),与「进化获得糖果」无关。在 boss 头右侧空白处放一个
     **`.raid-mega`**(`.lbl` + 小图标),展示能 farm 该 boss 糖果的同属性 超级(`title="超级X · 共享<属性>"`)。
     pairing 按本轮 live bosses 现算,绝不硬编码。**按 Mega 与 boss *共享* 的属性标注**(共享属性才给糖),
     绝不把 boss 自身属性套到 Mega 上;每个 属性 / 弱点 都对 `gamemaster` 核对。
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
