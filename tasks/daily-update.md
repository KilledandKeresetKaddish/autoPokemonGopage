# 每日更新任务 (daily update)

You are the daily operator for this Pokémon GO dashboard. Your working directory is
this repository. **Read `AGENTS.md` first and follow it exactly** — it defines what
you may edit, the hard rules, the data sources, and the schemas.

Do this now:

1. Read `AGENTS.md` and `data/state.json`.
2. Run `scripts/fetch.sh list`; fetch only what's stale or needed, e.g.
   `scripts/fetch.sh events raids events-hub events-pokebase tiers-attackers`. Don't refetch blindly.
3. Read the raw files in `data/raw/`. Adapt to their current structure.
4. Rewrite `public/data/events.json` (schema in AGENTS.md). Backbone = `events` (ScrapedDuck),
   then **merge the four event sources**: dedup the same real-world event to ONE row, aggregate
   each source's URL into `links[]`, fill `pokemon[]`/`bonuses[]`, and flag long-running events
   (`longTerm:true` for season / pass / league / >2-week). **Keep current + next month, drop
   events that ended before this month, use stable ids — no duplicates, no unbounded growth.**
5. Rewrite `public/data/rotations.json`: this month's 5★ / Mega / Max weekly boss rotation,
   parsed from the Hub monthly article (+ `raids.json`). Parse the bosses — never invent them.
6. Refresh the rankings regions in `public/index.html`:
   - `rankings-attackers` / `rankings-defenders` ← parse `data/raw/tiers-*.txt` (+ `tiers-pokebase`
     cross-check; surface the per-type 属性榜). Parse the lists — don't decide rankings yourself.
   - `rankings-raid` ← current bosses from `data/raw/raids.json` + counters justified by
     `data/raw/gamemaster.json`.
   - `rankings-current` (**free-form, most important**) ← what matters today: ongoing events +
     current raid bosses, and the best attackers/tanks to use for them.
   - `calendar-notes` ← free-form 本月看点. (Both free-form regions: use only the whitelisted classes.)
7. Update `public/data/meta.json` (`lastUpdated` = now, ISO 8601) and record per-source fetch
   times/notes in `data/state.json`.
8. Self-check (no duplicate ids, `links[]` aggregated, nothing >3 months old, long events flagged),
   then run `scripts/validate.sh` and fix whatever it reports until it passes.
9. Delete any duplicated or placeholder(waiting for annocement) event when there is an update, be smart.

Stay strictly within the files AGENTS.md allows. All user-facing text in 简体中文.
If a source is unreachable, keep the last good content and note it in `data/state.json`.
