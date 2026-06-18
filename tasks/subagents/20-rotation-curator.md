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

Output to the coordinator: changed file, parsed source sections, any uncertainties or
kept-last-good segments.
