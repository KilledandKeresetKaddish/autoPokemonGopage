# Sub-agent 90 — State + Validator

Goal: finish bookkeeping and prove the daily update is safe to publish.

Write scope:
- `public/data/meta.json`
- `data/state.json`

Inputs:
- Final outputs from Calendar, Rotations, and Rankings.
- Source Scout fetch / source-health notes.

Checklist:
1. Set `public/data/meta.json.lastUpdated` to the current UTC ISO 8601 timestamp.
2. Keep `data/state.json` as a fixed object keyed by source: last fetch/check times,
   content hashes if useful, and concise notes about source problems. Do not append a
   growing chronological log.
3. Self-check before validation:
   - no duplicate event ids;
   - no event ended before the retention window;
   - current + next month retained;
   - long-running events are flagged;
   - source links are aggregated where available;
   - rotations are parsed / corroborated, not invented;
   - ranking panels are not empty.
4. Run `scripts/validate.sh`.
5. If validation fails, coordinate fixes with the relevant owner and rerun until it
   passes. If a source is broken, keep last good content and record the limitation.

Output to the coordinator: exact validation command/result and changed bookkeeping
files.
