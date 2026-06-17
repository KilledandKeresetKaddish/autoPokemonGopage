# Sub-agent 20 — Rotation Curator

Goal: produce the current month's weekly boss rotation.

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
5. Include dex or form sprite ids in each segment's `pokemon[]`, with 简体中文 names.
6. Preserve theme colors: 5★ `#d8b25f`, Mega `#9c7bb0`, Max existing pink family.
7. Keep dates as `YYYY-MM-DD` and JSON valid.

Output to the coordinator: changed file, parsed source sections, any uncertainties or
kept-last-good segments.
