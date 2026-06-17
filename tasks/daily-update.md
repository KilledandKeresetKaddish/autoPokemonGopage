# 每日更新任务 (daily coordinator)

You are the **coordinator** for this Pokémon GO dashboard. Your working directory is
this repository. **Read `AGENTS.md` first and follow it exactly** — it defines what
you may edit, the hard rules, the data sources, schemas, and validation gate.

This run is intentionally split into focused sub-agent workstreams. If your coding
agent supports subagents / parallel workers, delegate the files below as bounded
read-only analysis or write scopes. If it does not, execute the same phases yourself
in order; the files are still the checklist of responsibilities.

## Sub-agent briefs

- `tasks/subagents/00-source-scout.md` — inspect `data/state.json`, run
  `scripts/fetch.sh list`, decide what is stale, fetch only needed sources, and
  summarize source health / notable raw-file structure changes.
- `tasks/subagents/10-calendar-curator.md` — own `public/data/events.json` and,
  only if needed for new event types, `public/data/categories.json`.
- `tasks/subagents/20-rotation-curator.md` — own `public/data/rotations.json`.
- `tasks/subagents/30-ranking-curator.md` — own only the AI-marked ranking / notes
  regions inside `public/index.html`.
- `tasks/subagents/90-state-validator.md` — own `public/data/meta.json` and
  `data/state.json`, then run validation after all content owners finish.

## Coordinator sequence

1. Read `AGENTS.md`, `data/state.json`, and every sub-agent brief above.
2. Run the Source Scout phase first. Do **not** blindly refetch everything; refresh
   by age / relevance using only `scripts/fetch.sh`.
3. After the raw sources are available, run Calendar, Rotations, and Rankings as
   separate workstreams. Keep write scopes disjoint:
   - Calendar writes `public/data/events.json` and maybe `public/data/categories.json`.
   - Rotations writes `public/data/rotations.json`.
   - Rankings writes only inside the five allowed AI markers in `public/index.html`.
4. Run the State + Validator phase last: set `public/data/meta.json.lastUpdated`,
   record fixed per-source notes in `data/state.json`, self-check, and run
   `scripts/validate.sh` until it passes.
5. If a source is unreachable or unparsable, keep the last good content, record the
   issue in `data/state.json`, and still pass validation. Never ship empty rankings.

Stay strictly within the files `AGENTS.md` allows during daily content updates. All
user-facing text must be 简体中文.
