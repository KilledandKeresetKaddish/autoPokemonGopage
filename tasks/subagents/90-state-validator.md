# Brief 90 — State + Validator

Goal/output: public/data/meta.json and data/state.json, then both existing gates.
Inputs: finalized 10–40 outputs and Scout's source/detail/date notes. Shared source
rules are embedded in AGENTS.md; detailed schemas/HTML in protected
`tasks/reference/daily-schemas.md` are read as needed. Bounded repairs: daily-update.

1. Set meta.lastUpdated to current UTC ISO 8601. Write state only now, not in earlier
   responsibilities. Keep the existing fixed per-source object (fetch/check times,
   16-hex cache hashes from fetch.sh list, concise status/gap notes), not a growing log.
   Advance processed source hashes only for inputs actually handled successfully; on
   failure retain the previous processed hash and distinguish observed material/time
   in the note. Raw freshness is not processing completion.
   `contentStatus` / `validation` from old state files are agent prose, NOT a
   wrapper gate result. On the next finalized content edit remove these stale
   assertions; put concise editorial judgments under `notes` only. Objective
   gate, timeout, publish, fetch and coverage results live exclusively in the
   ignored per-run `logs/runs/<run-id>/summary.json` and lastAttempt/lastSuccess.
   Never write a claimed wrapper publish result or a future lastSuccess to tracked state.
2. Maintain the small `details` mapping under AGENTS.md “Reuse and detail review”:
   original URL → full processed body hash, checkedAt and pending. Advance only after
   all affected canonical and English content is handled; keep old records on failures.
   Remove unreferenced records. In recovery compare to committed base state, never
   workspace draft or raw metadata. Update state.lastUpdated for date comparisons.
3. Self-check the shared content/schema/render contracts:
   - one real event/ID, exact source slugs, current+next-month/local coverage and 90-day
     history/retention; correct long-term/PvP/shiny flags and aggregated relevant links;
   - complete parsed rotation pools, base dex/form art/hub parity with raid drawers;
   - source-supported targeted Mega changes within existing legal values/mechanics;
   - Chinese species/moves from `fetch.sh zh` (NOT gamemaster), or the shared verified
     proper-name fallback; stable types/moves from gamemaster, new forms from live sources;
   - current recommendations and Boss/Max panels respect dates despite identical hashes;
     unchanged static panels remain, no empty/unsafe regions or leaked pipeline details;
   - exact English ID/key/array/region parity, no CJK, no dangling event references;
   - featured IDs all retained/admin-authorized; Spot Atlas byte-identical unless explicitly
     requested, then one raw name, operator facts and valid zones per schema;
   - public shell/protected files untouched and required wrappers/IDs preserved.
4. Run `scripts/preflight.sh` then `scripts/validate.sh`, report each exact exit/result
   as your own observation only (the wrapper independently executes and logs its gates).
   Repair via the owner scope in daily-update (maximum three rounds), including dependent
   English updates. Never weaken gates or claim unreadable sources were verified.

Finish with changed bookkeeping files, exact gate results and remaining gaps. Only the
existing wrapper can publish the validated content or preserve/roll back the failed draft.
