# Sub-agent 00 — Source Scout

Goal: make the raw source cache ready for the content curators without over-fetching.

1. Read `AGENTS.md` source rules and `data/state.json`.
2. Run `scripts/fetch.sh list`.
3. Decide which named sources are stale or relevant today:
   - `events`, `raids`, `events-hub`, `events-pokebase`, `events-official`: ~1 day.
   - `tiers-attackers`, `tiers-defenders`, `tiers-pokebase`: ~3 days.
   - `gamemaster`: ~7 days.
   - `eggs` / `research`: only when the current event needs them.
4. Fetch only needed sources with `scripts/fetch.sh <name> ...`.
5. Inspect refreshed `data/raw/*` enough to brief downstream agents on:
   - empty / flaky / changed formats;
   - likely monthly article sections for rotations;
   - event source coverage and any detail pages worth fetching later.
6. Do not edit site content files. If you must record fetch problems immediately,
   keep `data/state.json` as a fixed object keyed by source, not a growing log.

Output to the coordinator: fetched sources, skipped sources with reason, source
health notes, and any format changes that downstream agents must adapt to.
