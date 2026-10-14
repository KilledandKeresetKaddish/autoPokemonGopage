# Brief 00 — Source Scout

Goal: prepare source materials for the same Pi's later responsibilities, without
repeated requests. Shared rules: AGENTS.md “Data sources”, “Reuse and detail review”,
“Quiet-day and date advancement”, “Name verification”; sequence/recovery: daily-update.
These are already embedded, not file-read tasks.

Inputs: committed base state/events/rotations (never draft processing records), cache
metadata, current canonical content, operator note. Output: raw caches and running notes
only; no public content or state/meta writes here.

1. Run `scripts/fetch.sh list`; refresh named sources by actual last-successful cache
   time/relevance: event-bearing sources/raids 24h, tier sources ~3d, gamemaster ~7d,
   eggs/research when relevant. Respect failures; file existence alone is insufficient.
2. Once these inputs are final, run `scripts/discover.sh new --cached --json` and retain its
   JSON even if it exits 1. Contract: exit 0 = `complete`, 1 = `partial` with usable rows,
   2 = `failed`/usage; only `completeNoNew:true` is a quiet-day result. Consume normal
   `candidates`, `pendingDate` (verify dates; never invent them), `exceptions` and `gaps`.
   Do not repeat default-refresh discovery; `--cached` is zero-network. A failed source must
   not discard healthy-source leads. Compare final cache hashes against committed baseline
   **after** discovery, so no implicit feed refresh invalidates the comparison.
3. Inspect only new/changed bytes, adapting parsers to actual structure. Identify new
   or changed source entries by identity/date/detail fields, not just a whole-list hash.
   Carry affected IDs into `daily-candidates.js --changed ID`. Unchanged list bytes
   skip this re-derivation, **not** independent detail/date checks.
4. Treat retained unended events with `timing.scope/mode:unknown` or either
   boundary precision `date/unknown` as pending source checks, even if their legacy
   timestamp looks exact; never turn the current UTC date into a last-global-zone
   expiry. Feed explicit IDs into `--pending` where URLs are missing. Read the
   candidate report's `uncertainTimingIds`/`dateChecksAreHints` as warnings, not
   certified status; `docs/event-timing.md` is the contract.
5. Find the current month's Hub article URL in the index or via keyword discovery;
   its body is separate. Build the read-only candidate report with the committed base
   ref plus `--monthly-url`, changed IDs, explicit pending IDs, and `--force` IDs from
   operator verify/enrich/recheck requests. Inspect pending facts beyond prose markers.
   Candidate filtering does not replace source interpretation or intraday checks.
6. Group detail URLs across events. Execute each required force/24h refresh once; with the
   wrapper's shared `POGO_RUN_ID`, repeated exact URL force/failure calls are reused only for
   this run. Use `fetch.sh url --max-age 86400 --meta` when a refresh/path is needed without
   dumping a long body, then bounded extraction. After refresh, compare body hashes to committed
   `state.details`, not raw metadata/draft state. Retain all referencing IDs for Calendar if a
   shared page changed. Reuse fresh failed-run cache as material, but still process anything not
   covered by committed records; fetch success is not processed-state success.
7. Check current-through-next-month discovery AND non-LeekDuck coverage from Hub/official
   primaries, pokébase and searchable Fandom leads, including region/country/in-person
   events. Apply AGENTS.md's searchable sweep before a nonexistence verdict; Serebii is
   known-URL corroboration only. Missing URLs need keyword discovery, not guessed slugs.
   Do not re-search all stable distant/historical events every day.
8. Retain date checks (month, active events, Boss/Max, recommendations, retention), input
   hashes, successful URL reads/paths, skipped sources/reasons, format changes, unprocessed
   body deltas and source gaps. Calendar/Rotations/Rankings/English reuse these exact
   successful reads; only genuinely new requirements justify another request.
