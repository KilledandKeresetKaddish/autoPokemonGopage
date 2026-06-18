# Sub-agent 10 — Calendar Curator

Goal: produce the normalized calendar dataset.

Read first: `AGENTS.md` (rules · schemas · validation gate) — isolated sub-agents do
not inherit the coordinator's context.

Write scope:
- `public/data/events.json`
- `public/data/categories.json` only when a new event type needs registration

Inputs:
- `data/raw/events.json` as the authoritative backbone.
- `data/raw/events-hub.txt`, `data/raw/events-pokebase.txt`, and
  `data/raw/events-official.txt` for corroboration, extra links, summaries, bonuses,
  Pokémon, and details.
- Ad-hoc detail pages only via `scripts/fetch.sh url <allowlisted URL>` when a
  specific missing detail is needed.

Checklist:
1. Keep current month through end of next month; drop events that ended before the
   current month started.
2. Deduplicate by real-world event identity. Emit one stable deterministic `id` per
   event; never accumulate duplicates. When a real event is confirmed, delete the old
   placeholder ("待公布 / waiting for announcement") row it replaces — be smart, never
   leave both.
3. Aggregate real source URLs into `links[]` (`LeekDuck`, `Hub`, `Pokébase`, `官方`).
   Keep `link` as the primary URL. Never guess a URL you have not seen. **Confirm each link is
   about THIS exact event/Pokémon — not a same-category article for a different one (a Roggenrola
   Max Monday must NOT link Electabuzz's guide); omit rather than attach a wrong link.**
4. Fill concise 简体中文 `summary`, useful `bonuses[]`, `pokemon[]`, and event-specific
   `sections[]`. For raid / mega / raid-day items, add justified `counters[]` when
   source data supports it. **Verify every 简体中文 Pokémon name and move against
   `data/raw/gamemaster.json` (dex → species / move) or an allowlisted `pokeapi.co`
   lookup before writing it — never from memory; if you can't verify it, omit it or keep
   the source's English/romanized form rather than inventing one.**
5. Set `longTerm:true` for season / GO Pass / GO Battle League and spans longer than
   ~2 weeks so they render in the 长期活动 band.
6. Set `highlight:true` for 社区日, 团战日, and boosted-shiny events. Also mark shiny
   Pokémon and include a shiny bonus line.
7. Register only genuinely new `type` values in `public/data/categories.json` using
   approved palette keys and `kind` values from `AGENTS.md`.
8. All user-facing strings must be 简体中文; JSON must remain valid.

Output to the coordinator: changed files, event count, long-term count, highlighted
count, known source gaps kept from last good content.
