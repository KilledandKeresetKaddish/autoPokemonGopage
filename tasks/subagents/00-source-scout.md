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
   - event source coverage and any detail pages worth fetching later;
   - **missing per-event URLs** — when an event needs a page the bulk feeds don't carry (e.g. a
     Hub per-boss raid guide), find it with `scripts/discover.sh "<english keywords>"`, verify
     candidates with `scripts/fetch.sh url`, and hand the confirmed links to the Calendar curator
     (never guess a URL).
   - **newly-listed events** — run `scripts/discover.sh new` to surface feed events (this month +
     next) not yet in `public/data/events.json`, with cross-source corroboration; verify each with
     `scripts/fetch.sh url` and pass the real ones to the Calendar curator. Especially useful when
     the operator asks to "audit new + existing events".
   - **events LeekDuck doesn't carry** — Hub + 官网 are **co-equal primary** sources here, not mere
     corroboration. Many **region- / country-limited** events appear only on Hub's monthly roundup, the
     官网 news, or the Pokémon GO Wiki (Fandom) even when LeekDuck 404s. Run `scripts/discover.sh
     "<keywords>"` — it now searches **LeekDuck + Hub + 官网 + Fandom** — and read the `events-hub` /
     `events-official` / `events-pokebase` bulk files for anything **absent from the LeekDuck feed**;
     confirm each lead with `scripts/fetch.sh url` and hand it to the Calendar curator so it never drops
     a region/local event for LeekDuck's silence. A "doesn't exist" verdict requires that **searchable
     sweep** to come up empty — never LeekDuck alone. (`serebii.net` has no search/bulk feed —
     corroboration via a known URL only, not part of the sweep.) Real fetched URLs only, never guessed.
6. Do not edit any site content or bookkeeping files — including `data/state.json`.
   Report fetch problems in your output; State + Validator (90) is the sole writer of
   `data/state.json` and records them for you.

Output to the coordinator: fetched sources, skipped sources with reason, source
health notes, and any format changes that downstream agents must adapt to.
