# 每日更新任务 (daily update)

You are the daily operator for this Pokémon GO dashboard. Your working directory is
this repository. **Read `AGENTS.md` first and follow it exactly** — it defines what
you may edit, the hard rules, the data sources, and the schemas.

Do this now:

1. Read `AGENTS.md` and `data/state.json`.
2. Run `scripts/fetch.sh list`; fetch only the sources that are stale or needed
   (`scripts/fetch.sh events raids tiers-attackers ...`). Don't refetch everything blindly.
3. Read the raw files in `data/raw/`. Adapt to their current structure.
4. Rewrite `public/data/events.json` (normalized events, schema in AGENTS.md) — keep
   the current and next month.
5. Refresh the rankings regions in `public/index.html`:
   - `rankings-attackers` / `rankings-defenders` ← parse `data/raw/tiers-*.txt`.
   - `rankings-raid` ← current bosses from `data/raw/raids.json` + counters justified
     by `data/raw/gamemaster.json`.
   - `rankings-current` (**most important**) ← what matters today: ongoing events +
     current raid bosses, and the best attackers/tanks to use for them.
   - `calendar-notes` ← short 本月看点 (optional).
6. Update `public/data/meta.json` (`lastUpdated` = now, ISO 8601) and record per-source
   fetch times/notes in `data/state.json`.
7. Run `scripts/validate.sh` and fix whatever it reports until it passes.

Stay strictly within the files AGENTS.md allows. All user-facing text in 简体中文.
If a source is unreachable, keep the last good content and note it in `data/state.json`.
