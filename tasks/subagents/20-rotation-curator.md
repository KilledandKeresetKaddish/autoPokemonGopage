# Sub-agent 20 — Rotation Curator

Goal: produce the current month's weekly boss rotation.

Read first: `AGENTS.md` (rules · schemas · validation gate) — isolated sub-agents do
not inherit the coordinator's context.

Write scope:
- `public/data/rotations.json`

Inputs:
- `data/raw/events-hub.txt` for the monthly article / rotation schedule.
- `data/raw/raids.json` for corroborating current bosses.
- `data/raw/gamemaster.json` or allowlisted PokeAPI lookups only when dex / form ids
  need confirmation.

Checklist:
1. Set `month` to the current month (`YYYY-MM`).
2. Build exactly the three tracks: `5star`, `mega`, and `max`.
3. Parse boss names and date ranges from sources; never invent rotations.
4. Use complete coverage for the whole month so 5★ / Mega day icons do not vanish.
5. Include dex ids in each segment's `pokemon[]`, with 简体中文 names
   **verified against `data/raw/gamemaster.json` (dex → species) — never a name from memory.**
   - **Mega / form segments:** set `pokemon[].id` to the **BASE national-dex** — the *same* id that
     boss uses in `events.json` — and put the mega look in `"sprite"`. Do **not** use the mega-form
     id as `id`: the calendar links a Mega day-icon to its raid event by dex-id match, so a mega-form
     id makes the icon open a bare, link-less drawer (e.g. 超级巨钳螳螂 → `id:212` + `sprite:.../10046.png`).
6. Preserve theme colors: 5★ `#d8b25f`, Mega `#9c7bb0`, Max existing pink family.
7. Keep dates as `YYYY-MM-DD` and JSON valid.
8. **你拥有"日期角标"。** 日历数字旁的 5★/超级角标**只**由这里的 `5star`/`mega` 段产生
   —— `events.json` 的事件变不成角标。**多日"每日轮换"事件(传奇之路 / GO Fest 前置周等):**
   为活动覆盖的每一天在 `5star`/`mega` 轨各加一个**单日段**(`start==end`),`pokemon[]` **直接取自当天
   对应的 `raid-battles` 事件**(calendar-curator 出的;5★ 段 = 事件里非超级/原始 Boss,超级段 = 当天
   超级/原始)。`month` 只是标签、不影响渲染,所以为下月初的跨月活动加单日段没问题。
9. **角标 ↔ 抽屉必须一致**:`renderRotations()` **逐字**渲染 `seg.pokemon`,所以段里**别只放几只"代表"**
   —— 放全当天池子,与抽屉事件 `pokemon[]` 对齐(角标自身只显示前 3 只、会循环)。池子太大时用段名 `cn`
   标注"多种轮替"。每个 `raid-battles` 事件都要有 dex+日期匹配的段,否则角标隐藏了它的 bar 又没角标 = 消失。
10. **发布前跑 `scripts/preflight.sh`** 自检(拦截 orphan raid、角标↔抽屉不一致、form-id 误用);
    `run-daily.sh` 已在 `validate.sh` 前强制运行。详见 AGENTS.md《渲染契约》。

Output to the coordinator: changed file, parsed source sections, any uncertainties or
kept-last-good segments.
