# Brief 90 — State + Validator

This is the current agent's final responsibility. Its governing rules were already
embedded once; do not reload them unless a specific passage was lost to compaction.
Never delegate or spawn work through Bash, an API, an extension, or another agent/CLI.

Goal: finish bookkeeping and prove the daily update is safe to publish.

Write scope:
- `public/data/meta.json`
- `data/state.json`

Inputs:
- Final outputs from Calendar, Rotations, Rankings, and English Curator.
- Source Scout fetch / source-health notes.

Checklist:
1. Set `public/data/meta.json.lastUpdated` to the current UTC ISO 8601 timestamp.
2. Write `data/state.json` only now, using the Source Scout notes you retained; the
   earlier responsibility did not write the file. Keep it a fixed object keyed by source: last
   fetch/check times, **the 16-hex sha256 of each cache** (as printed by `fetch.sh list` —
   next run's skip/fast-path decisions depend on these, so they are mandatory), and concise
   notes about source problems — fold in Source Scout's notes here. Do not append a growing
   chronological log.
3. Self-check before validation:
   - no duplicate event ids;
   - no event ended before the retention window;
   - current + next month retained;
   - long-running events are flagged;
   - source links are aggregated where available;
   - rotations are parsed / corroborated, not invented;
   - every 简体中文 Pokémon name & move is verified against `gamemaster` (no hallucinated / garbled names);
   - Chinese ranking panels are not empty and each keeps its required
     `[data-ai-region="…"]` wrapper;
   - `public/data/i18n/en.json` has exact canonical event IDs, category/track keys,
     segment + nested-array lengths, five non-empty safe English regions, and no CJK
     fallback; `public/data/i18n/ui.json` remains checksum-protected and untouched;
   - `featured.json` is an array of ids that all still exist in `events.json` (Calendar pruned
     it — validate.sh hard-rejects stale featured ids);
   - `locations.json` has unique stable ids, one trim-non-empty raw `name` per spot, valid IANA
     zones, only `isoWeekday/hour/minute` in its schedule, and no persisted runtime fields; unless
     an explicit operator note requested a Spot Atlas change, Calendar left it byte-identical;
   - no internal pipeline details (`data/raw/*` paths, script names) in user-visible text;
   - render contract holds (AGENTS.md《渲染契约》): every `raid-battles` event has a matching
     `rotations.json` 角标 segment (or is `longTerm`), single-day segment `pokemon[]` match their drawer
     event, Mega/5★ segments use BASE dex ids — `preflight.sh` checks these.
4. Run `scripts/preflight.sh` **then** `scripts/validate.sh`; report each exact result. Both must exit 0
   to publish (`run-daily.sh` enforces this and rolls back on either failure).
5. If validation fails, identify the responsible scope, return to that earlier
   checklist yourself, fix it, then repeat this final responsibility until it passes
   (subject to the three-round cap in `daily-update.md`). If a source is broken, keep
   last good content and record the limitation.

Finish with the exact validation command/result and changed bookkeeping files in your
run summary.
