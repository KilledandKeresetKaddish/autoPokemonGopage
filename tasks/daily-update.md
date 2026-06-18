# 每日更新任务 (daily coordinator)

You are the **coordinator** for this Pokémon GO dashboard. Your working directory is
this repository. **Read `AGENTS.md` first and follow it exactly** — it defines what
you may edit, the hard rules, the data sources, schemas, and validation gate.

This run is intentionally split into focused sub-agent workstreams. If your coding
agent supports sub-agents / parallel workers — e.g. Pi via a sub-agent extension
(`pi-subagents` / `pi-sub-agent`), which runs each brief in an isolated `--no-session`
subprocess (optionally worktree-isolated) — delegate each brief below as a bounded
read-only or write scope. The only concurrent step is **Calendar ∥ Rotations** (2
tasks, well within the default maxTasks 8 / concurrency 4); every other phase is
sequential. Isolated sub-agents do **not** inherit this prompt, so each brief restates
that it must read `AGENTS.md` first. If your agent has no sub-agent support, execute
the same phases yourself in order; the briefs are still the checklist of
responsibilities.

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
3. After the raw sources are available, run Calendar and Rotations as separate
   workstreams. They may run in parallel because their write scopes are disjoint:
   - Calendar writes `public/data/events.json` and maybe `public/data/categories.json`.
   - Rotations writes `public/data/rotations.json`.
4. Wait for Calendar and Rotations to finish, then start Rankings with the finalized
   `public/data/events.json` and `public/data/rotations.json` (or pass those exact
   results explicitly). Rankings must not build `calendar-notes` or
   `rankings-current` from previous/stale calendar or rotation files while sibling
   workstreams are still writing today's outputs. Rankings writes only inside the
   five allowed AI markers in `public/index.html`.
5. Run the State + Validator phase last: it sets `public/data/meta.json.lastUpdated`,
   records fixed per-source notes in `data/state.json` (it is the **sole writer** of
   `data/state.json`), self-checks, and runs `scripts/validate.sh`. **You (the
   coordinator) own the fix loop:** if validation fails, read the reported failures,
   re-dispatch the responsible owner (Calendar / Rotations / Rankings) to fix its own
   scope, then re-run validation — repeat until it passes. State + Validator reports; it
   never reaches into another owner's scope.
6. If a source is unreachable or unparsable, keep the last good content, record the
   issue in `data/state.json`, and still pass validation. Never ship empty rankings.

Stay strictly within the files `AGENTS.md` allows during daily content updates. All
user-facing text must be 简体中文.

If an **OPERATOR NOTE** block is appended at the very end of this prompt, treat it as a
one-off extra requirement for this run only: fold it into whichever workstream(s) it
affects, still bound by every AGENTS.md hard rule — skip and note anything out of scope
(e.g. a protected-file change) rather than forcing it through.

When the note asks you to **add or fix a link, enrich or verify an event, fill in missing details,
or force a recheck**, that is a fetch job, not a memory job: run `scripts/discover.sh "<english
keywords>"` to find candidate URLs, open each with `scripts/fetch.sh url <URL>`, and edit only from
what you read. Do **not** reply that you "can't access the network / search" — you can, via those
scripts (see AGENTS.md, *"You have full network access — use it, never refuse."*).
