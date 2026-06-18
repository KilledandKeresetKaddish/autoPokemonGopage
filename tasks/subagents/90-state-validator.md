# Sub-agent 90 — State + Validator

Goal: finish bookkeeping and prove the daily update is safe to publish.

Read first: `AGENTS.md` (rules · schemas · validation gate) — isolated sub-agents do
not inherit the coordinator's context.

Write scope:
- `public/data/meta.json`
- `data/state.json`

Inputs:
- Final outputs from Calendar, Rotations, and Rankings.
- Source Scout fetch / source-health notes.

Checklist:
1. Set `public/data/meta.json.lastUpdated` to the current UTC ISO 8601 timestamp.
2. You are the **sole writer** of `data/state.json` (Source Scout reports its notes to
   you; it does not write the file). Keep it a fixed object keyed by source: last
   fetch/check times, content hashes if useful, and concise notes about source problems
   — fold in Source Scout's notes here. Do not append a growing chronological log.
3. Self-check before validation:
   - no duplicate event ids;
   - no event ended before the retention window;
   - current + next month retained;
   - long-running events are flagged;
   - source links are aggregated where available;
   - rotations are parsed / corroborated, not invented;
   - every 简体中文 Pokémon name & move is verified against `gamemaster` (no hallucinated / garbled names);
   - ranking panels are not empty.
4. Run `scripts/validate.sh` and report its exact result.
5. You only report — you never edit another owner's scope. If validation fails, hand
   the specific failures (and which owner must fix what) to the coordinator, which
   re-dispatches the fix and asks you to re-run validation; repeat until it passes. If a
   source is broken, keep last good content and record the limitation.

Output to the coordinator: exact validation command/result and changed bookkeeping
files.
