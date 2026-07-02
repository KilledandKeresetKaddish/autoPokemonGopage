# 每日更新任务 (daily coordinator)

You are the **coordinator** for this Pokémon GO dashboard. Your working directory is
this repository. **Read `AGENTS.md` first and follow it exactly** — it defines what
you may edit, the hard rules, the data sources, schemas, and validation gate.

This run is intentionally split into focused sub-agent workstreams. If your coding
agent supports sub-agents — e.g. Pi via a sub-agent extension (`pi-subagents` /
`pi-sub-agent`), which runs each brief in an isolated `--no-session` subprocess
(optionally worktree-isolated) — delegate each brief below as a bounded read-only or
write scope. **All phases run sequentially**: Rotations copies its single-day
segments' `pokemon[]` from Calendar's finalized `raid-battles` events (and
`preflight.sh` hard-FAILs any 角标↔抽屉 divergence), so Calendar must finish before
Rotations starts — disjoint *write* scopes do not make that read-coupled contract
race-free. Isolated sub-agents do **not** inherit this prompt, so each brief restates
that it must read `AGENTS.md` first. If your agent has no sub-agent support, execute
the same phases yourself in order; the briefs are still the checklist of
responsibilities.

## Sub-agent briefs

- `tasks/subagents/00-source-scout.md` — inspect `data/state.json`, run
  `scripts/fetch.sh list`, decide what is stale, fetch only needed sources, and
  summarize source health / notable raw-file structure changes.
- `tasks/subagents/10-calendar-curator.md` — own `public/data/events.json`,
  `public/data/featured.json` (admin/operator-note feature requests + pruning stale
  ids), `public/data/mega.json` (append-only: new Mega/Primal roster rows) and,
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
3. After the raw sources are available, run **Calendar first**, to completion: it
   writes `public/data/events.json` (plus `featured.json` / `mega.json` /
   `categories.json` when their duties apply).
4. Then run **Rotations** with Calendar's finalized `public/data/events.json` as an
   explicit input (its single-day segments must copy those events' `pokemon[]`; if
   its sources reveal a boss the calendar missed, report back — you re-dispatch
   Calendar, then Rotations again). Then run **Rankings** with both finalized files
   (or pass those exact results explicitly). Rankings must not build
   `calendar-notes` or `rankings-current` from previous/stale calendar or rotation
   files. Rankings writes only inside the five allowed AI markers in
   `public/index.html`.
5. Run the State + Validator phase last: it sets `public/data/meta.json.lastUpdated`,
   records fixed per-source notes in `data/state.json` (it is the **sole writer** of
   `data/state.json`), self-checks, and runs `scripts/preflight.sh` **then**
   `scripts/validate.sh` (`run-daily.sh` enforces both before publish — either non-zero
   rolls the run back). **You (the coordinator) own the fix loop:** if **either** gate
   fails, read the reported failures, re-dispatch the responsible owner to fix its own
   scope, then re-run the gates. Owner map: events/featured/mega/categories → Calendar ·
   rotations → Rotations · AI regions → Rankings · meta/state → State + Validator.
   **Cap the loop at 3 rounds**; if a failure class has no owner or survives 3 rounds
   (e.g. a protected-file hash mismatch you cannot legitimately fix), stop, record the
   exact failure in `data/state.json` for a developer, and let `run-daily.sh` roll the
   run back rather than forcing it. `preflight.sh` flags render-contract breakage
   (orphan raids, 角标↔抽屉 mismatch, mega form-id) that `validate.sh`'s structural
   checks can't see. State + Validator reports; it never reaches into another owner's
   scope.
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

When the note asks for **日历角标 / day-badges on specific dates** — e.g. "给某些天加 Boss 角标", or
splitting a multi-day event (传奇之路 / GO Fest 前置周) into per-day Bosses — route it to **Rotations**,
not Calendar-as-chips. Day-badges come **only** from `rotations.json`; an `events.json` `raid-hour`
chip can never become a 角标. Follow AGENTS.md《渲染契约》: one banner event + an all-day `raid-battles`
per Boss (Calendar) **and** matching single-day `5star`/`mega` segments (Rotations) whose `pokemon[]`
equal those events. `scripts/preflight.sh` rejects orphan raids and 角标↔抽屉 mismatch, so such a note
must reach **both** workstreams — dispatched **in order** (Calendar first, then Rotations reading its
finalized events).

When the note asks to **feature / unfeature an event(金框)**, route it to **Calendar**: it owns
`public/data/featured.json` — add or remove that event's `id` only on such an explicit request, and
prune ids whose events left `events.json`. A newly announced **Mega/Primal** likewise routes to
Calendar (`mega.json`, append-only, per AGENTS.md).
