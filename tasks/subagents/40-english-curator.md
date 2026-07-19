# Sub-agent 40 — English Curator

Goal: keep the English edition in lockstep with the finalized Simplified-Chinese
canonical content from this same daily run.

Read first: `AGENTS.md` (bilingual contract · schemas · validation gate). This is a
**foreground-only** headless phase: never launch async/background work and never
return before your write is complete.

Write scope:
- `public/data/i18n/en.json` only

Never edit `public/data/i18n/ui.json`; it is owner-maintained and checksum-protected.
Never edit canonical facts (`events.json`, `rotations.json`, `categories.json`,
`mega.json`) or the Chinese marker regions.

Inputs (all must be the finalized outputs from this run):
- `public/data/events.json`
- `public/data/rotations.json`
- `public/data/categories.json`
- `public/data/mega.json` (`en` already supplies each roster form's English name)
- The five `[data-ai-region="…"]` wrappers inside `public/index.html`
- Source pages/cache used by the Chinese curators when official English terminology
  is needed. `scripts/fetch.sh zh <dexId|move:slug>` returns English in column 2 and
  Simplified Chinese in column 3; use it rather than guessing species/move names.

`en.json` is a **text-only overlay**. Its schema is:
```json
{
  "version": 1,
  "events": {
    "<canonical event id>": {
      "name": "English title",
      "heading": "English category/source heading",
      "summary": "English summary",
      "bonuses": ["same count/order as canonical bonuses[]"],
      "pokemon": ["English name for each canonical pokemon[] entry"],
      "counters": [
        { "name": "English Pokémon", "fast": "English move or empty", "charged": "English move or empty" }
      ],
      "sections": [
        {
          "title": "English title",
          "items": ["same count/order as canonical items[]"],
          "body": "English body or empty",
          "mons": ["English name for each canonical mons[] entry"]
        }
      ]
    }
  },
  "rotations": {
    "note": "English note",
    "tracks": {
      "<canonical track key>": {
        "label": "English label",
        "segments": [
          { "name": "English source name", "cn": "English display name", "pokemon": ["English names in canonical order"] }
        ]
      }
    }
  },
  "categories": { "<every categories.json key>": "English label" },
  "regions": {
    "calendar-notes": "<inert English HTML>",
    "rankings-current": "<inert English HTML>",
    "rankings-attackers": "<inert English HTML>",
    "rankings-defenders": "<inert English HTML>",
    "rankings-raid": "<inert English HTML>"
  }
}
```

Checklist:
1. Keep **exact event-ID parity** with `events.json`: add translations for new IDs,
   update changed IDs, and delete translations for pruned IDs. Never translate or
   normalize an ID.
2. Mirror every localized array's exact canonical length and order: event bonuses,
   Pokémon, counters, sections and each section's items/mons. The overlay carries
   text only—never copy dates, IDs, links, sprites, flags, booleans or mechanics.
3. Keep rotation track keys exact and segment/Pokémon array counts in canonical
   order. Translate labels/names only; canonical dates and dex IDs drive behavior.
4. Translate all five Chinese rich regions after Rankings finishes. Preserve inert
   HTML structure, approved classes, `data-event-id`, URLs, `data-hub`, sprite/type
   icon paths, tier letters and numeric facts. English regions contain no marker
   comments and no wrapper div; each value is just the wrapper's inner HTML.
5. English means English-only visible prose: no CJK fallback. Preserve `:icon-token:`
   strings exactly. Keep official trademarks and official English Pokémon/move/form
   names. Verify names from source/PokeAPI; do not literal-translate a proper name.
6. Never add `<script>`, `<style>`, iframe/object/embed, event-handler attributes,
   `javascript:` or unsafe URL schemes. Keep all five region values non-empty.
7. Surgical quiet-day path: if canonical event/rotation/Chinese-region content is
   unchanged, leave the already-verified English text untouched. When only a few
   IDs changed, edit only those entries and any affected current/highlight regions;
   do not retranscribe the full 200KB overlay.
8. Run `jq empty public/data/i18n/en.json`, then `scripts/validate.sh`. Report exact
   parity/safety failures to the coordinator; fix only this file.

Output to the coordinator: changed event IDs/rotation tracks/region names, terminology
checks performed, and exact validation result.
