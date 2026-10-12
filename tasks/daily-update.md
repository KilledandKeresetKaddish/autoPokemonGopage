# 每日更新任务 — one Pi, six sequential responsibilities

The wrapper embeds AGENTS.md, this task and the six briefs in full, exactly once.
References below mean those **already-embedded sections**, not instructions to read the
files again. Re-read only a specifically lost passage after genuine context compaction.

Complete 00 → 10 → 20 → 30 → 40 → 90 yourself in one context. No delegation through
tools, Bash, APIs, extensions or another coding-agent CLI; no child agents, parallel
writers, background workstreams or separate sessions. AGENTS.md owns permissions,
sources, schemas, render contracts and shared rules; this task owns order and recovery.

## Sequence and dependencies

1. **00 Source Scout:** choose the last-successful committed baseline, prepare sources,
   run `discover.sh new --cached --json` and consume its candidates/pending-date leads/exceptions/gaps
   even when its partial exit is nonzero, then compare the final inputs with that baseline.
   Apply AGENTS.md “Reuse and detail review” even when list hashes match; retain URL
   cache paths, changed-entry IDs, pending facts, operator rechecks and date-change hints.
2. **10 Calendar:** finalize events first, with featured/category maintenance and
   source-backed Mega additions or targeted completions/corrections (including confirmed
   initialCost/superMax). Spot Atlas changes only on an explicit operator request.
3. **20 Rotations:** use Calendar's finalized events and the cached monthly article
   body. Single-day segment Pokémon must match their raid drawers. If sources reveal a
   missing boss, return to Calendar and correct it before continuing Rotations.
4. **30 Rankings:** use both finalized files, not stale/draft inputs. Update only the
   affected Chinese AI regions, including changes caused by date advancement. Preserve
   unchanged static attacker/defender panels.
5. **40 English:** translate finalized text only, preserving canonical identity/order
   and rich HTML facts. Reuse the same verified URL/name cache; do not download again.
   If canonical content is unchanged, retain its verified overlay entries/regions.
6. **90 State + Validator:** only now write meta/state, including processed-detail
   records only for content actually handled successfully. Run preflight then validate.
   Both must pass before the existing wrapper can publish either language.

## Recovery and operator priority

Normally the committed `HEAD:data/state.json` is the last-successful processing baseline.
With a **RECOVERED DRAFT**, first inspect its changes, then execute the entire sequence.
Use `git show <base-head>:data/state.json` from the block for hash/time comparisons;
its committed events/rotations also provide the previous date-dependent content.
Workspace state and raw cache, even when fresh and hash-identical to one another, cannot
prove processing finished. Compare cached details to committed processed hashes. Correct
stale draft work and reuse valid material; never infer quiet-day from draft bookkeeping.
Freshness, discovery, detail triggers and date maintenance are still mandatory.

The **OPERATOR NOTE** is an additional one-run requirement, not a replacement for normal
work. Positional note priority and recovered-draft handling are supplied by the wrapper;
AGENTS.md hard rules still win. Record out-of-scope requests for development.
- Event/link/detail verification or enrichment → Scout/Calendar; force requested URLs
  once, bypassing ordinary TTL, then reuse throughout the sequence.
- Day-badges → Calendar's raid drawers **then** Rotations' matching segments (AGENTS.md
  “渲染契约”); raid-hour chips cannot create badges.
- Feature/unfeature, Mega roster completion, or explicit Spot Atlas edits → Calendar,
  within AGENTS.md's respective administrator/source/schema boundaries.

## Bounded gate repair

Run `scripts/preflight.sh` **then** `scripts/validate.sh`. On either failure, return to
its owner checklist yourself, fix only that scope, update dependent outputs (including
English), and rerun both gates. Maximum **three repair rounds**, not an open-ended loop.
Owners: events/featured/mega/categories/authorized locations → 10; rotations → 20;
Chinese AI regions → 30; English → 40; meta/state → 90.

If a failure has no daily-editable owner or survives three rounds, stop and record the
exact failure for a developer. Never modify protected files, weaken gates or delegate.
Let the existing wrapper preserve the pending draft and roll back. Unreachable or
unparsable sources retain last good content and explicit gaps, never blank rankings.
Finish with exact gate results; do not claim publication or freshness without evidence.
