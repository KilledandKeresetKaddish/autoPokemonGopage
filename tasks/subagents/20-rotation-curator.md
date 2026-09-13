# Brief 20 — Rotation Curator

Goal/output: current month's public/data/rotations.json only. Apply already-embedded
AGENTS.md “Content requirements → Rotations”, “渲染契约”, rotations schema and shared
name/cache/date policies; do not reload them.

Inputs: Calendar's finalized raid events; Scout's cached monthly Hub article BODY and
its committed processed hash; raids cache for corroboration. The Hub index only finds
the article, and its hash never substitutes for the monthly body's hash.

1. Check month rollover even with identical lists. Use the current confirmed month
   article via Scout's successful URL cache; if not prepared, use the same 24h URL rule
   and record the result for later reuse. Never relabel old content as a new schedule.
2. If body, raids and finalized event inputs are unchanged and month is current, leave
   rotations byte-identical. Otherwise edit affected segments, parsing names and ranges
   from actual sources; failed sources preserve last-good segments with explicit gaps.
3. Cover the whole month with 5star/mega/max tracks. A genuinely new tier gets its own
   key/color/≤2-character tag per schema; preserve theme colors and opt-out semantics.
4. Verify dex/type facts using gamemaster, Chinese species via `fetch.sh zh <dexId>` and
   form existence/art via verified live sources. Apply the shared proper-name fallback.
5. For multi-day daily rotations, copy each day's COMPLETE Pokémon pool from Calendar's
   all-day raid-battles drawers into single-day segments; divide ordinary/Mega bosses
   appropriately. Base dex IDs must match drawers, with form sprite/hub overrides.
   Cross-month single-day segments are allowed (`month` is only a label). Large pools
   use a concise “多种轮替” display name, not truncated data.
6. If the source exposes a boss missing from Calendar, return to 10 yourself before
   continuing; never create diverging drawer/badge facts. The final preflight checks
   orphan raids, Pokémon parity and form-ID mistakes.

Before continuing: retain changed segments, parsed body sections/hash, kept-last-good
segments and uncertainties. Hand final content to Rankings, then English; no state writes.
