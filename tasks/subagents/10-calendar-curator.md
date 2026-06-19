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
3. Aggregate real source URLs into `links[]` (`LeekDuck`, `Hub`, `Pokébase`, `官方`) for **every
   event — every type, every week through the end of next month**, not just raids. Keep `link` as the
   primary URL. If the bulk feed didn't surface a per-event URL, fetch it on demand. When no per-event
   article exists, a source's **generic category guide** is acceptable **only if it genuinely covers
   this event**. Never guess a URL you have not seen. **Confirm each link is about THIS exact
   event/Pokémon — not a same-category article for a different subject; omit rather than attach a wrong
   link.** Don't settle for LeekDuck-only unless you checked the other sources and nothing fits.
4. Fill concise 简体中文 `summary`, useful `bonuses[]`, `pokemon[]`, and event-specific
   `sections[]`. For raid / mega / raid-day items, add a **concise** justified `counters[]` (top
   picks — keep the calendar drawer light; the exhaustive counters + Mega pairings live in the
   ranking 当前团战 Counter tab). **Emit the weekly Mega raid as its own `raid-battles` event too**
   (Mega form sprite, same boss dex id as its rotation segment) so the Mega day-icon's drawer carries
   counters + links, not just a name. **Verify every 简体中文 Pokémon name and move against
   `data/raw/gamemaster.json` (dex → species / move) or an allowlisted `pokeapi.co` lookup before
   writing it — never from memory; if you can't verify it, omit it or keep the source's
   English/romanized form rather than inventing one.** But **don't use gamemaster to decide whether a
   Mega/form *exists*** — it lags new content (Legends Z-A …). If a source features one (e.g. "<X>
   Super Mega Raid Day"), render the Mega and trust the live source, not gamemaster's absence.
5. Set `longTerm:true` for season / GO Pass / GO Battle League and spans longer than
   ~2 weeks so they render in the 长期活动 band.
6. Set `highlight:true` for 社区日, 团战日, and boosted-shiny events. Also mark shiny
   Pokémon and include a shiny bonus line.
7. Register only genuinely new `type` values in `public/data/categories.json` using
   approved palette keys and `kind` values from `AGENTS.md`.
8. All user-facing strings must be 简体中文 — including each event `name` (title): never leave a
   source's English headline; build it from the event's verified 简体中文 `pokemon[]` name + category.
   JSON must remain valid.
9. **日期角标不归你管 —— 归 rotation-curator(`rotations.json`)。** `events.json` 的事件只会渲染成
   bar 或 chip,**变不成日期数字旁的角标**。要给某些天加 5★/超级 Boss 角标(含 传奇之路 / GO Fest 前置周
   这类多日每日轮换),按 AGENTS.md《渲染契约》:主活动出 1 条横幅事件;当天每个 Boss 出**全天 `raid-battles`**
   事件(**别用 `raid-hour` chip 模拟每日 Boss** —— 那既出不了角标、超长名还挤乱周列),并让 rotation-curator
   为这些天加**单日段**、`pokemon[]` 与你的事件对齐。每个 `raid-battles` 都要有匹配角标,否则 `preflight.sh`
   会判它 orphan(被角标隐藏 bar 后静默消失)。

Output to the coordinator: changed files, event count, long-term count, highlighted
count, known source gaps kept from last good content.
