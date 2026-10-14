# Brief 40 — English Curator

Goal/output: public/data/i18n/en.json only, after Chinese facts/regions are finalized.
Apply the `tasks/reference/daily-schemas.md` English overlay schema, inert-HTML rules and
“Name verification”; do not reload them. Never edit ui.json or canonical facts here.

Inputs: this run's final events/rotations/categories/mega (its en field already names
forms), five Chinese wrapper bodies, and the same source/name caches used above.

1. Maintain exact canonical event IDs, category/track keys and nested-array lengths/
   order (bonuses, Pokémon, counters, sections and their items/mons, rotation segments).
   Add/update only affected translations; delete pruned event entries. Text only:
   do not duplicate dates/dex/links/sprites/flags/mechanics into overlay data fields.
2. Translate each changed Chinese rich region's inner HTML, without marker comments or
   wrapper divs. Preserve classes, data-event-id/data-hub, links, sprite/type-icon paths,
   tier letters and numeric facts. Clean dangling references in both locales via the
   responsible Chinese checklist where necessary.
3. English-only prose, no CJK fallback; preserve icon tokens and official trademarks.
   Names use exact source spelling or column 2 of `fetch.sh zh <dexId>` /
   `zh move:<slug>`, not literal translations. Reuse prior successful URL reads; do
   not refetch sources merely to translate. Refer uncertain facts back to their owner.
4. All five HTML regions stay non-empty and inert. Preserve unchanged verified entries/
   regions byte-for-byte on quiet days; only date-affected canonical regions require
   matching English changes. No full overlay retranscription.
5. Run `jq empty public/data/i18n/en.json`; retain parity/safety concerns for 90's
   combined gates, rather than repeating the full validator before state is finalized.

Before continuing: retain changed IDs/tracks/regions, terminology evidence and unresolved
facts. Report which source details are fully reflected in both editions for processed-state
bookkeeping; untranslated or unhandled facts are not successfully completed work.
