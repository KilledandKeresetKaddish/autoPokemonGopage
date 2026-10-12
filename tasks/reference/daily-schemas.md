# Daily content schemas and HTML reference (read on demand)

## Schemas

`public/data/events.json` — array the calendar + 长期活动 band render:
```json
{
  "id": "slug-string",
  "name": "活动名称",
  "type": "community-day",
  "heading": "Community Day",
  "summary": "一句话简体中文说明(显示在详情抽屉)。",
  "start": "2026-06-01T10:00:00",
  "end": "2026-06-01T13:00:00",
  "image": "https://cdn.leekduck.com/....png",
  "link": "https://leekduck.com/events/....",
  "links": [
    { "label": "LeekDuck", "url": "https://leekduck.com/events/...." },
    { "label": "Hub", "url": "https://pokemongohub.net/post/event/...." }
  ],
  "bonuses": ["双倍星尘", "..."],
  "pokemon": [{ "name": "皮卡丘", "id": 25, "shiny": true }],
  "counters": [{ "id": 248, "name": "班基拉斯", "fast": "齿突", "charged": "啃咬" }],
  "sections": [{ "title": "付费内容", "items": [":pokeball: 票务 4.99 美元", "..."] }],
  "longTerm": false,
  "highlight": false
}
```
- `start`/`end` ISO 8601; `end` may equal `start`. `summary`/`bonuses`/`pokemon`/`links`/`longTerm`/`highlight` optional.
- `summary`: a **concise 简体中文** description (1–2 sentences), shown as a paragraph in the detail drawer
  so the panel isn't just a title + date.
- **Sprites & forms:** `pokemon[]` / `counters[]` / rotation segments take `id` (national-dex →
  `…/sprites/pokemon/<id>.png`) + 简体中文 `name` (+ `shiny`). The base id shows the **base** sprite —
  for **Mega / Primal / Gigantamax / regional** forms set the form's sprite instead: use the form's
  PokeAPI *pokemon* id as `id`, or add `"sprite": "<url>"` from `pokeapi.co/api/v2/pokemon/<name>/`
  (`sprites.front_default`; e.g. `scizor-mega`, `skarmory-mega`, `raichu-mega-x`). pokeapi.co is allowlisted.
  **Exception — rotation Mega segments:** keep `id` = the **base** dex (matching that boss's
  `events.json` entry) and use the `"sprite"` override for the mega look; a mega-form `id` there breaks
  the day-icon → raid-event link (see the rotations.json schema note below).
- **Clickable sprites → Hub DB (automatic).** Every Pokémon sprite the site renders — event drawer,
  weekly rotations, all ranking panels, the free-form notes — is **auto-linked** to
  `https://db.pokemongohub.net/pokemon/<id>` by `app.js`; you don't hand-write `<a>` tags. (Only the
  **calendar grid day-icons + 长期/PVP band** are left un-linked, because their icons/pills open the
  in-page drawer.)
  A base `id` only links to the base page, so for a **form** add an optional **`hub`** slug on that
  `pokemon[]` / `counters[]` / rotation-segment entry to hit the exact form page: `"hub": "212-Mega"` ·
  `"150-Mega_Y"` · `"77-Galarian"` · `"105-Alolan"` (id `-Form`, `_` for X/Y). In the **static** ranking
  HTML put the same on the `<img>` as `data-hub="212-Mega"`; plain base-id sprites need nothing.
- `counters`: best raid/团战 counters (`id` for the sprite + 简体中文 `name` + optional `fast`/`charged`
  moves) → rendered as a collapsible "团战 Counter" block. Fill for raid / mega / raid-day events from the
  Hub raid guide or `db.pokemongohub.net`, justified by `gamemaster` — **don't invent**.
- `sections`: **free-form** collapsible blocks `[{ "title": "...", "items": ["..."] }]` or
  `[{ "title": "...", "body": "一段文字" }]` (`body` renders as a paragraph instead of a list) or
  `[{ "title": "...", "mons": [{ "id": 144, "name": "急冻鸟", "shiny": true }, …] }]` (`mons` renders as a
  **caption-less sprite-icon grid** — dex `id` + sprite/hub conventions like `pokemon[]`/`counters[]`; name
  shows only on hover, no text/moves) — **you decide
  per event** what's worth surfacing (付费/票务、限时调查步骤、栖息地时段、Field Research 任务、奖励清单…).
  Titles and contents are yours to choose; 付费内容 is just one example. Use them to bring the useful
  detail inline instead of forcing users out to the source link.
- **Icons:** the repo ships icons in `public/assets/icons/`, **always at a locked size** via the `ico`
  (inline) / `ico-lg` (standalone) class. In `bonuses`/`sections` text use a `:token:` (e.g.
  `:stardust: 捕捉星尘 ×3`, `:water: 水属性`); in the free-form regions write
  `<img class="ico" src="assets/icons/<file>">`. Tokens — types: `bug dark dragon electric fairy fighting
  fire flying ghost grass ground ice normal poison psychic rock steel water`; items: `candy xl-candy rare-candy
  stardust xp lure incense incubator golden-razz silver-berry pokeball pokestop raid spawn rocket trading`.
  Unknown tokens fall back to `<token>.png`; missing files hide. Use where it adds clarity (e.g. a type
  icon next to a counter, an item icon next to a bonus). **Only use tokens from the two lists above** —
  invented ones (`gift`, `research`, …) have no asset and render blank (`preflight.sh` warns). And the
  `:token:` regex eats any `:…:`, so **never put a time like `7/7:18:00` in `bonuses`/`sections`** — the
  `:18:` is swallowed and the line shows mangled; write `7/7 18:00` (space, not colon).
- `link` (single) is kept for back-compat; prefer `links[]` to point at **every** source for the event.
- `longTerm:true` → renders in the 长期活动 band instead of the grid (auto for season/pass
  and spans >~2 weeks; set `false` to force back onto the grid).
- `pvp:true` → renders in the **PVP活动 band** instead of the grid (auto for `go-battle-league`;
  use for 杯赛 / 对战周末 / 对战日; set `false` to force back onto the grid; `display:"pvp"` mirrors it).
  Checked before `longTerm`, so a long PVP season lands in PVP, not 长期活动.
- `highlight:true` → ✨ indicator on the calendar bar/chip (shiny boost). Set it for 社区日
  (Community Day), 团战日 (Raid Day), and any event with **boosted shiny odds**. Put the shiny detail
  in `pokemon[].shiny` (✨ on the sprite) and add a `bonuses[]` line like "✨ 闪光概率提升".
  The gold border is driven separately by `featured.json` (admin-controlled); `highlight` no longer
  controls the border.

`public/data/rotations.json` — the current month's weekly boss rotation:
```json
{
  "month": "2026-06",
  "note": "5★/超级团战每周三轮换 · Max 团战每周轮换",
  "tracks": [
    { "key": "5star", "label": "5★ 团战", "color": "#d8b25f", "tag": "5★",
      "segments": [
        { "name": "Zekrom", "cn": "捷克罗姆",
          "pokemon": [{ "id": 644, "name": "捷克罗姆" }],
          "start": "2026-06-10", "end": "2026-06-16" }
      ] },
    { "key": "mega", "label": "超级团战", "color": "#9c7bb0", "tag": "M", "segments": [ "…" ] },
    { "key": "max",  "label": "极巨团战", "color": "#bd7f97", "tag": "MX", "segments": [ "…" ] }
  ]
}
```
- Tracks 5★ / Mega / Max (+ any future tier). `cn` = displayed name; `pokemon[]` may hold >1 boss
  (dual/triple rotations — they **cycle** inside one day-number icon). `start`/`end` = `YYYY-MM-DD`.
- **Every track with `pokemon` renders as small icons next to each day's number** (the grid no longer
  draws weekly-raid bars). So keep rotations.json **complete for the whole month**, or those raids
  vanish from the grid. `color` drives both the rotation section and the day-icon ring — 5★ = gold
  `#d8b25f`, Mega = purple `#9c7bb0`, Max = mauve `#bd7f97`. `tag` (**≤2 chars**) is the icon's corner
  badge — set it on every track (5★/M/MX are built-in fallbacks; a new tier with no `tag` falls back to
  the first 2 letters of its `key`). To keep a track **out** of the day cells, set `"showOnCalendar": false`.
- **A Mega/5★ day-icon links to its raid event by *dex id* — keep the id consistent.** Clicking an
  icon opens the drawer of the matching `events.json` raid (its counters / links / summary). The
  matcher compares `pokemon[].id`, so a rotation segment **must use the SAME id as that boss's
  `events.json` raid entry** — i.e. the **BASE national-dex id** (Mega 巨钳螳螂 → `212`, *not* the
  mega-form id `10046`), with the mega look supplied via `"sprite"`. Put a mega-form id here and the
  icon opens a **bare, link-less drawer** (it can't find its event — this is a real bug, not cosmetic).

`public/data/locations.json` — Spot Atlas stable facts (operator-note maintenance only):
```json
{
  "schemaVersion": 1,
  "schedule": { "isoWeekday": 2, "hour": 20, "minute": 0 },
  "spots": [{
    "id": "stable-url-safe-id", "countryCode": "TH", "name": "Ban Phue",
    "lat": 17.688021, "lng": 102.473581, "timeZone": "Asia/Bangkok",
    "kind": "gym", "status": "tested", "group": null, "rating": null,
    "needsReview": false, "note": "人少、资源也较少"
  }]
}
```
- `name` is the only location-name field: required, string, trim-non-empty, and shown verbatim
  in both locales. Never add `nameZh` / `nameEn`, and never put spot names in an i18n file.
- `schedule` contains only `isoWeekday` / `hour` / `minute`; never add `displayTimeZone`.
  Each row's `timeZone` is an IANA zone for that location. The viewer's display zone is detected
  at runtime by the browser and is never stored here or selected from the website locale.
- Never infer a timezone from longitude and never save a fixed offset. The following are runtime
  derivatives and forbidden in every spot row: `flag`, `utcOffset`, `browserTime`, `displayTime`,
  `chinaTime`, `nextTuesday`, `mapUrl`.
- Keep `id` stable and lowercase URL-safe; `countryCode` is uppercase ISO alpha-2; latitude /
  longitude are numeric and in range, and two rows may not share the exact same numeric pair.
  `kind` is exactly `gym` / `showcase` / `both`; `status` is exactly `tested` / `candidate` /
  `mixed`; `rating` is exactly `null` / `1` / `2` / `3` (integers only); `group` is null or a
  non-empty string; `needsReview` is boolean; `note` remains the operator's original text.
  Add/change/remove rows only from explicit operator facts—do not discover, translate, geocode or
  “clean up” them on your own.

`public/data/meta.json`:
```json
{ "lastUpdated": "2026-06-15T08:00:00Z", "note": "optional short status" }
```


`public/data/i18n/en.json` — English text-only overlay over the canonical files:
```json
{
  "version": 1,
  "events": {
    "canonical-event-id": {
      "name": "English title", "heading": "English heading", "summary": "English summary",
      "bonuses": ["same count/order as canonical bonuses[]"],
      "pokemon": ["English name per canonical pokemon[] entry"],
      "counters": [{ "name": "English Pokémon", "fast": "English move", "charged": "English move" }],
      "sections": [{ "title": "English title", "items": [], "body": "", "mons": [] }]
    }
  },
  "rotations": {
    "note": "English note",
    "tracks": { "5star": { "label": "5★ Raids", "segments": [
      { "name": "English name", "cn": "English display name", "pokemon": ["English names"] }
    ] } }
  },
  "categories": { "every-custom-category-key": "English label" },
  "regions": {
    "calendar-notes": "<inert English inner HTML>",
    "rankings-current": "<inert English inner HTML>",
    "rankings-attackers": "<inert English inner HTML>",
    "rankings-defenders": "<inert English inner HTML>",
    "rankings-raid": "<inert English inner HTML>"
  }
}
```
- It contains **text only**. IDs/dates/URLs/dex IDs/sprites/flags/mechanics remain in
  canonical files and are never duplicated here.
- `events` keys exactly equal canonical event IDs. `bonuses`/`pokemon`/`counters`/
  `sections`, and each section's `items`/`mons`, exactly mirror canonical lengths/order.
  Use empty arrays/strings only where the corresponding canonical field is absent.
- Rotation tracks are keyed by canonical `track.key`; segment arrays and their Pokémon
  name arrays exactly mirror canonical order/length. `categories` keys exactly equal
  `categories.json` keys.
- `regions` values are the inner HTML only (no marker/wrapper); same inert-HTML and class
  policy as Chinese. All five are required and non-empty. `validate.sh` rejects any CJK
  character in this English file to prevent mixed-language fallback.
- `public/data/i18n/ui.json` is the owner-maintained static UI dictionary. It is
  checksum-protected and **never** a daily-agent write target.

`public/data/categories.json` — register NEW event types (colours are code, you assign a family, not a hex):
```json
{ "some-new-type-slug": { "palette": "blue", "label": "新活动类型", "kind": "bar" } }
```
- Only needed when a source introduces a `type` not already styled (the common ones —
  community-day, raid-battles, raid-day, raid-hour, research, choose-your-path, event,
  go-battle-league, spotlight-hour / pokemon-spotlight-hour, max-mondays, go-pass, season,
  pokemon-go-fest — are **built in**; don't re-add them). Otherwise leave this `{}`.
- `palette` MUST be one of the theme keys (assign the colour **family**, you cannot invent a hex):
  `purple` 旗舰 · `green` 社区日 / `greenlt` 聚焦时刻 · `rust` 团战Boss / `orange` 团战时刻 /
  `red` 团战日(特殊单日) · `teal` 调查 / `teallt` 限时调查 · `blue` 活动 · `indigo` 对战联盟 ·
  `mauve` Max周一 · `gold`·`brown` 长期 band. Pick the family that matches the activity.
- `kind`: `bar` (spans days) or `chip` (single-day marker); optional `bg:true` for a muted band.
- Validation **rejects** off-palette colours or a bad `kind`, so you can't drift off-theme.

## Free-form synthesis (your creative space)
`calendar-notes` (本月看点) and `rankings-current` (本期推荐) are **free-form inert-HTML
canvases** — use editorial judgment when their source/date/note inputs change; otherwise
retain verified content under the quiet-day policy. These are raw HTML, not Markdown;
backticks are not formatting and would appear literally. The other regions
(`rankings-attackers/defenders/raid`) stay structured: parse the sources, don't free-style.
Inside each marker, preserve its existing `<div data-ai-region="…">` and write Chinese
content inside that wrapper; English Curator copies the finalized meaning/structure into
`en.json.regions` (without the wrapper itself). Use **only** these whitelisted,
theme-correct classes (no inline colors, no `<style>`, no `<script>`):
- containers: `.panel` / `.panel-head`, `.note-grid` (auto-responsive columns), `.callout` (highlight box)
- lists/atoms: `.rank-list` / `.rank-item`, `.pill` / `.pillrow`, `.badge`, `.btn` / `.btn-primary`, `.muted`,
  `.meta`(rank-item / boss 头里的小字附注行)
- Pokémon/tiers: `.mon-icon`, `.mon-row` / `.mon` / `.shiny`, `.tier` + `.tier-S|tier-A|tier-B|tier-C`
- sprites/icons: `<img class="spr">` or `class="mon-icon"` (PokeAPI dex-id URL); `<img class="ico">` /
  `class="ico-lg"` for the local resource icons in `assets/icons/` (size locked).
- **clickable event names** (本月看点 = `calendar-notes`): wrap a headline event's name in
  `<span class="event-link" data-event-id="<events.json id>">名称</span>` (a `<span>`, or an `<a>` with no
  `href`) — `app.js` opens that event's detail popup on click (underline marks it clickable). The
  `data-event-id` **must** equal an existing `events.json` `id` (an unknown id just stays inert text, so
  prune links when you remove the event). Use it to let 本月看点 jump to a drawer; the popup only opens on
  the calendar view, so keep these in `calendar-notes`, not the rankings regions.
- current-raid blocks (structured `rankings-raid` only): one **`.raid-wall`** (3-up card grid) wrapping
  per-boss **`.raid-block`** cards. Each card = a **`.raid-boss`** header (`<img class="boss-icon">` +
  **`.binfo`**, which holds a **`.btop`** badge/name row above a **`.meta`** 属性/弱点 row) and a
  **`.raid-mega`** 4-列网格 of **6–8** same-属性 Mega sprites pinned to the header's right (no text label —
  `.lbl` is CSS-hidden), with **`.rank-list.mini`** **flat** counter rows beneath (`mon-icon` / `strong` /
  `.meta` are siblings — no wrapper `<div>` — so the move `.meta` right-aligns). Type icons via `.ico`.

`rankings-current` should tie today's live events + current raid bosses to the best
attackers/tanks to use (e.g. a Max/Dynamax event → the relevant Max picks).

## Ranking HTML pattern (use the existing CSS classes)
```html
<div class="rank-list">
  <div class="rank-item">
    <span class="tier tier-S">S</span>
    <img class="mon-icon" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/384.png" alt="烈空坐">
    <div><strong>烈空坐</strong><div class="meta">龙息 / 画龙点睛</div></div>
  </div>
</div>
```
当前团战 Counter — **按星级从高到低**;**全部 boss 卡放进一个 `.raid-wall`(每行 3 张)**。每张卡:boss 头
(`.binfo` 里 `.btop` 档次/名 一行,`.meta` 属性/弱点 一行)+ **头右 `.raid-mega` 4-列网格(6–8 个同属性
超级,按超级攻击力高→低,上限 8,无文字标)** + **拍平的** `.rank-list.mini` counter 行(`mon-icon` /
`strong` / `.meta` 平级,招式 `.meta` 右对齐)。**属性一律用图标**。占位符按本轮实际 boss 填:
```html
<div class="raid-wall">
  <div class="raid-block">
    <div class="raid-boss">
      <img class="boss-icon" src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/<bossDexId>.png" alt="<boss 名>">
      <div class="binfo">
        <div class="btop"><span class="badge">&lt;档次&gt;</span><strong>&lt;boss 名&gt;</strong></div>
        <div class="meta"><img class="ico" src="assets/icons/<type>.webp" alt="<属性>"> · 弱 <img class="ico" src="assets/icons/<weak>.webp" alt="<弱点>"></div>
      </div>
      <!-- 头右 Mega:6–8 个同属性超级,按超级攻击力排序,上限 8,无 .lbl 文字标 -->
      <div class="raid-mega">
        <img src="…/<megaFormDexId>.png" data-hub="<dexId>-Mega" title="超级X · 共享<属性>" alt="超级X">
        <!-- …其余同属性 Mega(共 6–8 个)… -->
      </div>
    </div>
    <div class="rank-list mini">
      <div class="rank-item"><img class="mon-icon" src="…/<counterDexId>.png" alt="<counter 名>"><strong>&lt;counter 名&gt;</strong><div class="meta"><img class="ico" src="assets/icons/<moveType>.webp" alt="<招式属性>"> &lt;fast&gt; / &lt;charged&gt;</div></div>
    </div>
  </div>
  <!-- …其余 boss 卡同结构,全部包在这一个 .raid-wall 内… -->
</div>
```
**属性→图标文件**(扩展名不统一,务必照此):`fire.png water.webp grass.webp electric.webp ice.webp
fighting.png poison.webp ground.webp flying.png psychic.webp bug.png rock.webp ghost.webp dragon.png
dark.webp steel.webp fairy.webp normal.webp`;`一般` = `normal.webp`。counter 招式属性由
`gamemaster` 的 move→type 求得。Keep it readable on mobile.

---
