# 每日更新任务 (single-Pi sequence)

You are the one current Pi responsible for this complete Pokémon GO dashboard update.
The wrapper has already embedded `AGENTS.md`, this task, and all six briefs exactly
once. Those rules are in context now: do not re-read the files merely to reload them;
after genuine context compaction, re-read only a specifically lost passage.

Complete every brief yourself in numbered order. Never delegate or spawn work through
Pi tools, Bash, an API, an extension, or another coding-agent CLI. Do not split the run
into child agents, background jobs, parallel writers, or separate sessions.

**All phases run sequentially**: Rotations copies its single-day segments' `pokemon[]`
from Calendar's finalized `raid-battles` events (and `preflight.sh` hard-FAILs any
角标↔抽屉 divergence), so Calendar must finish before Rotations starts. The English
text layer likewise runs only after finalized Chinese content; both editions are
maintained by you in the same fact pipeline.

## Sequential responsibility briefs

- `tasks/subagents/00-source-scout.md` — inspect `data/state.json`, run
  `scripts/fetch.sh list`, decide what is stale, fetch only needed sources, and
  summarize source health / notable raw-file structure changes.
- `tasks/subagents/10-calendar-curator.md` — own `public/data/events.json`,
  `public/data/featured.json` (admin/operator-note feature requests + pruning stale
  ids), `public/data/mega.json` (append-only: new Mega/Primal roster rows), and,
  only when an operator note explicitly changes Spot Atlas data,
  `public/data/locations.json`; only if needed for new event types it also owns
  `public/data/categories.json`.
- `tasks/subagents/20-rotation-curator.md` — own `public/data/rotations.json`.
- `tasks/subagents/30-ranking-curator.md` — own only the AI-marked Chinese ranking /
  notes regions inside `public/index.html`.
- `tasks/subagents/40-english-curator.md` — own `public/data/i18n/en.json`, the
  text-only English overlay for finalized events, rotations, categories and all five
  rich regions. It never duplicates dates, IDs, links, sprites or flags.
- `tasks/subagents/90-state-validator.md` — finish `public/data/meta.json` and
  `data/state.json`, then run validation after the preceding responsibilities.

## Required sequence

1. The governing rules and briefs are already embedded. Determine the last-successful
   source state, then perform every responsibility below yourself without delegation.
   On a normal run it is the current committed `data/state.json`. With a
   `RECOVERED DRAFT`, the workspace copy is unfinished: read the committed base state
   named in that block (for example via `git show`) for source hash/time comparisons.
2. Run the Source Scout responsibility first. Do **not** blindly refetch everything; refresh
   by age / relevance using only `scripts/fetch.sh`. Determine **which sources' hashes
   changed** vs that last-successful baseline, and carry the delta into every later responsibility:
   unchanged sources need no re-derivation, and if nothing event-bearing changed, take
   AGENTS.md's **quiet-day fast path** (date-driven maintenance only) instead of
   doing full rebuilds.
3. After the raw sources are available, run **Calendar first**, to completion: it
   writes `public/data/events.json` (plus `featured.json` / `mega.json` /
   `categories.json` when their duties apply). It writes `locations.json` only when the
   operator note explicitly requests a Spot Atlas row change; ordinary runs leave it untouched.
4. Then do **Rotations** from Calendar's finalized `public/data/events.json`
   (its single-day segments must copy those events' `pokemon[]`; if its sources reveal
   a boss the calendar missed, return to the Calendar responsibility yourself, fix it,
   then redo the affected Rotation work). Then do **Rankings** with both finalized
   files. Rankings must not build
   `calendar-notes` or `rankings-current` from previous/stale calendar or rotation
   files. Rankings writes only inside the five allowed AI markers in
   `public/index.html`.
5. Run **English Curator** after Rankings. It reads the finalized canonical Chinese
   files + five Chinese region wrappers and updates the English text overlay in
   `public/data/i18n/en.json`. It must finish with exact event/track/segment/array
   parity and all five non-empty English region strings; it never writes structural
   facts. If Chinese content is unchanged, keep its verified English entries as-is.
6. Run the State + Validator responsibility last: it sets
   `public/data/meta.json.lastUpdated`, records fixed per-source notes in
   `data/state.json` (write state only here), self-checks, and runs
   `scripts/preflight.sh` **then** `scripts/validate.sh` (`run-daily.sh` enforces both
   before publish — either non-zero blocks it). If **either** gate fails, read the
   report, return to the responsible checklist yourself, fix that scope, then re-run
   the gates. Scope map: events/featured/mega/categories/explicit locations changes →
   Calendar · rotations → Rotations · Chinese AI regions → Rankings · English
   overlay/regions → English Curator · meta/state → State + Validator.
   **Cap the loop at 3 rounds**; if a failure class has no owner or survives 3 rounds
   (e.g. a protected-file hash mismatch you cannot legitimately fix), stop, record the
   exact failure in `data/state.json` for a developer, and let `run-daily.sh` preserve
   the draft and roll the working tree back rather than forcing it. `preflight.sh` flags render-contract breakage
   (orphan raids, 角标↔抽屉 mismatch, mega form-id) that `validate.sh`'s structural
   checks can't see. The same Pi returns to the corresponding responsibility checklist,
   fixes it, then reruns preflight and validate, for at most three rounds. Never delegate,
   start another agent, or modify protected files to bypass a gate.
7. If a source is unreachable or unparsable, keep the last good content, record the
   issue in `data/state.json`, and still pass validation. Never ship empty rankings.

Stay strictly within the files `AGENTS.md` allows during daily content updates.
Canonical files and the five `index.html` marker regions use 简体中文;
`public/data/i18n/en.json` uses English only. Both editions must describe the same
facts and ship atomically.

If an **OPERATOR NOTE** block is appended near the end of this prompt, treat it as a
one-off extra requirement for this run only: fold it into whichever responsibility or
responsibilities it affects, still bound by every AGENTS.md hard rule — skip and note
anything out of scope (e.g. a protected-file change) rather than forcing it through.

If a **RECOVERED DRAFT** block follows it, inspect that possibly incomplete draft and
then still execute this entire sequence. In particular, do Source Scout, freshness,
discovery, and date maintenance. The block's committed base state is the
last-successful source baseline; workspace `data/state.json` is unfinished draft output
and its hashes/timestamps can never justify a quiet day. Correct stale draft work and
reuse still-valid work rather than blindly redoing it.

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
must reach **both** responsibilities **in order** (Calendar first, then Rotations reading its
finalized events).

When the note asks to **add / remove / rename / correct a Spot Atlas location**, route it to
**Calendar** as an operator-only data edit. It may change `public/data/locations.json` but must not
translate names or invent missing coordinates/timezones. Keep one raw `name`, a stable URL-safe `id`,
the exact schedule `{isoWeekday,hour,minute}`, a valid location IANA `timeZone`, and no persisted
runtime derivatives (`flag`, offsets, browser/display times, next target or map URL). `name`, `note`
and coordinates never enter the English overlay. With no such note, leave this file byte-identical.

When the note asks to **feature / unfeature an event(金框)**, route it to **Calendar**: it owns
`public/data/featured.json` — add or remove that event's `id` only on such an explicit request, and
prune ids whose events left `events.json`. A newly announced **Mega/Primal** likewise routes to
Calendar (`mega.json`, append-only, per AGENTS.md).
