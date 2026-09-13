# Brief 30 — Ranking Curator

Goal/output: only inner HTML of the five Chinese AI wrappers in public/index.html:
calendar-notes, rankings-current, rankings-attackers, rankings-defenders, rankings-raid.
Preserve all markers/wrappers, rank-panel structure and IDs. Shared contracts are in
already-embedded AGENTS.md “Content requirements → Rankings”, “Free-form synthesis”,
“Ranking HTML pattern”, “Name verification” and “Quiet-day and date advancement”.

Inputs: finalized Calendar/Rotations from THIS run; Scout's tier/raid/gamemaster caches,
verified detail paths, date changes and gaps. Do not use stale/draft calendar inputs.

1. Check active events, Boss/Max transitions and the recommendation window by source
   dates, not just hashes. Inspect intraday boundaries too: day-prefix candidate hints
   cannot resolve event-local live times worldwide. Retire ended recommendations and
   surface just-started ones using verified times, without inventing timezones.
2. Keep unchanged static attacker/defender panels even when dates/bosses change. For
   changed tier sources, parse S/A/B/C tables and attackers' per-type picks, cross-check
   pokébase and render the specified rank-list rows; never decide tiers from memory.
3. Update rankings-raid when its live boss set or relevant counter/source facts change,
   including active Max/Dynamax. Follow the shared detailed layout: tier-descending
   raid-wall cards, large boss headers, type/weakness icons, flat fuller counter rows
   with move-type icons, and per-boss same-type Mega grids (attack-descending, cap 8;
   do not pad/drop genuine eligible forms merely to hit 6). Verify form existence live.
4. Name checks are `fetch.sh zh <dexId>` / `zh move:<slug>`; gamemaster supplies stable
   dex/English/type/move facts, never Chinese names. Use the shared explicit fallback.
   Reuse already-verified body/name caches, including those from preceding responsibilities.
5. Compose calendar-notes (monthly highlights with valid clickable event IDs) and
   rankings-current (live priorities/bonuses/shiny windows/directional training advice)
   only when affected source/date/note inputs change. No duplicate counter dumps in
   editorial regions. Prune dangling event references after retention changes.
6. Inert HTML and approved classes only. On parse/fetch failure, preserve the affected
   last-good panel and report the limitation, never empty it. Keep pipeline diagnostics
   out of visible text. Unaffected regions remain byte-identical.

Before continuing: retain edited region names, parsed source sections, handled URL
hashes, date changes, pending facts and panels kept from last good content. English runs next.
