# Brief 10 — Calendar Curator

Goal: finalize the normalized calendar before Rotations. Apply the AGENTS.md “Content requirements → Calendar”, “渲染契约”, `tasks/reference/daily-schemas.md`, “Name verification”
and “Reuse and detail review”; do not reload the common rules.

Write scope: events.json; featured.json for explicit feature requests and stale-ID pruning;
categories.json only for new types; mega.json for source-backed additions or targeted
completion/correction; locations.json only for explicit operator edits. All paths under
public/data/. Do not write English or bookkeeping yet.

Inputs: Scout's final named caches, verified URL body paths/hash deltas, candidate IDs,
source gaps and operator note. LeekDuck is the structured backbone, not an existence
veto; retain Hub/official co-equal primary coverage and corroborating sources.

1. Process new/changed entries **and independent detail candidates**, including active,
   next-7-day, pending and operator-triggered events even if list hashes are identical.
   Reuse Scout's successfully refreshed bodies. A changed shared URL requires inspecting
   every affected event; fresh cached bytes absent from committed processed state still
   need interpretation. Far-future complete or ended events need no blanket daily sweep.
2. Keep current through next month, confirmed farther dates and ~90-day history, including
   regional/country/local events with explicit location text. Deduplicate real-world
   identity using the exact source slug. When a real event replaces a pending placeholder,
   remove that placeholder rather than publishing both. For each new/edited event include
   full `timing`; see `docs/event-timing.md`. Check scope, wall/absolute mode, each boundary
   precision, and (regional local only) single-venue IANA zone against the detail. Missing
   source facts stay unknown/date-only; never infer exact from clock-looking legacy fields.
   Keep source URL and short timing basis for 90's bounded `state.timingEvidence` map.
3. Apply the Calendar content checklist: verified aggregated links, concise Chinese
   title/summary/bonuses/Pokémon, useful event-specific sections, concise raid counters,
   weekly Mega raid drawers, long-term/PvP flags, genuine shiny boosts and new palettes.
   Source-verified English/romanized proper-name fallback is allowed only under “Name
   verification”: species via `fetch.sh zh <dexId>`, moves via `zh move:<slug>`; never
   Chinese from gamemaster. Forms require live existence evidence, not cache absence.
4. Follow the render contract: Calendar supplies banner and all-day raid-battles drawers
   for daily rotations; the next responsibility supplies badges. Keep base dex/form
   sprite/hub consistency and complete Pokémon pools, not representative subsets.
5. **Mega roster:** add unique newly announced forms; also allow verified updates to
   existing unknown/wrong fields (null initialCost → confirmed supported cost, officially
   announced superMax, etc.). Preserve identity, avoid duplicates/unrelated rewrites or
   unsupported deletions. No derived mechanics/table edits; unsupported new mechanics
   become developer notes, never relaxed schema/gates. Follow `tasks/reference/daily-schemas.md` mega schema,
   including confirmed form art, candy-boost type exceptions and legal values.
6. Apply explicit featured/Spot Atlas requests within their shared schemas. Otherwise
   locations stays byte-identical; never geocode, translate, infer zones or persist runtime
   derivatives. Feature IDs are administrator choices, not inferred from shiny boosts.
7. Perform date/retention maintenance even on quiet days. Prune *canonical history* using
   confirmed calendar-end dates when >90 days old; a null end must not be treated as start
   expiry. This is separate from reminder closeAt (`null` must never auto-expire). Prune
   featured references and hand affected English/rich-region references forward. Edit only changed rows; preserve last-good content on source failure.

Before continuing: retain changed IDs/files, counts (events/long-term/highlight), all
handled detail URLs/hashes and remaining pending facts/gaps for 90. A detail record may
advance only after its affected canonical AND English content is successfully finalized.
