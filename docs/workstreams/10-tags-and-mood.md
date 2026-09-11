# Workstream 10 — Tag Chips, Filter/Sort, Mood Scoring & Tagging Audit

> **Follow-up — see `docs/workstreams/11-audio-transcription-and-ai-ops.md`.**
> §2's sort bar shipped with real bugs (Apply refetched the wrong list on
> the normal `?path=notes` view; drag-reordering silently discarded custom
> sort order) — both fixed there, and drag-to-reorder was then removed
> entirely per a follow-up request (sort is now the only ordering concept).
> That doc also covers the tag-generation concurrency-safety hardening
> (`appendTagsIfUnchanged`) that §5's `AiService.suggestTags` call site now
> goes through.

Not part of the original `docs/PROJECT_BRIEF.md` (that document is kept verbatim
as the original brief — see its correction notes for the pattern this repo
uses instead of editing it). This is a later, separately-requested round of
work, done directly on `main` (no dedicated branch), covering: tag chips on
every card, a real sort dimension for entries (date/size/mood), clickable tag
stats in Analytics, a structured multi-axis mood-scoring system, a backfill
job for notes AI tagging never reached, and the ability to create/manage tags
directly instead of only via `#hashtag` in note content.

Status: **implemented, uncommitted on `main`** as of this writing. Nothing
below has been run against a live DB/Ollama instance — same "code/config
prep, verify on the real host" split this repo has used throughout (see
`docs/deployment-checklist.md`).

## 1. Tag chips on every note card

Previously, tags only rendered on long "blog-mode" cards
(`cardBlogBox.tsx`), via inline logic duplicated nowhere else — a short note
never showed its tags on its card at all.

- New shared component `app/src/components/Common/TagList/index.tsx`:
  flattens a note's `tagsToNote[]` into deduped `#a/b/c` paths (via
  `helper.buildHashTagTreeFromDb`/`generateTagPaths`, the same logic
  `cardBlogBox.tsx` used to own), shows the first 3 as clickable `.blinko-tag`
  pills (click → `navigate('/?path=all&searchText=#path')`, same
  filter-by-tag behavior as before), and — when there are more — a `+N` pill
  that opens a `Popover` listing the rest plus the note's created/updated
  timestamps.
- Wired into `app/src/components/BlinkoCard/cardFooter.tsx`'s `RightContent`
  row, so it shows on **every** card now, not just blog-mode ones.
- `cardBlogBox.tsx` had its duplicate inline version removed and now relies
  on `cardFooter.tsx`'s `TagList` instead — no behavior change, just one
  fewer copy of the same logic.

## 2. Filter & sort bar under the new-entry box

The existing filter popover (`app/src/components/Common/PopoverFloat/filterPop.tsx`,
already covering tag/date-range/with-link/with-file/public/has-todo
filtering with working Apply/Reset) had no sort controls, and its only
trigger lived in the header — easy to miss. Extended rather than replaced:

- **Sort field added to `note.list`** (`server/routerTrpc/note.ts`):
  `sortField: 'date' | 'size' | 'mood'` (default `'date'`, preserves the
  pre-existing `createdAt`/`updatedAt` + `config.isOrderByCreateTime`
  behavior) and `moodAxisId: number | null`. `'size'` orders by the new
  `contentLength` generated column (see §4); `'mood'` orders by
  `notes.moodScores`'s JSON path for the given axis id, via Prisma's
  Postgres JSON-path `orderBy`.
  **Unverified in this environment — flagged inline in the code**: no live
  DB was available to confirm Prisma 5.22's JSON-path `orderBy` behaves as
  expected here. If mood-sort doesn't order correctly once deployed, the
  fallback is a `$queryRaw`-based ID ordering scoped to just that one branch
  — check `server/routerTrpc/note.ts`'s `sortOrderBy` construction first.
- **`FilterPop.tsx`** gained a "Sort" section: Newest / Oldest / Longest /
  Shortest, plus two dynamically-generated options per active mood axis
  ("Most `<positiveLabel>`" and, for bipolar axes only, "Most
  `<negativeLabel>`") — fetched live via `api.ai.moodAxisList.query()`. A
  single composite `field:direction[:axisId]` string drives the `Select`,
  parsed back into `sortField`/`orderBy`/`moodAxisId` on Apply. Reset also
  resets sort back to Newest.
- **Placement**: `app/src/pages/index.tsx` renders a new
  `FilterSortSummaryBar` right under the create-entry editor
  (`<BlinkoEditor mode='create' />`) — a small "Tag: x · Sort: Newest"
  summary line plus a second `<FilterPop />` trigger, so filtering/sorting
  is visible without opening the header icon first. The header trigger is
  untouched; both read/write the same `blinkoStore.noteListFilterConfig`.
- `blinkoStore.tsx`'s `noteListFilterConfig` gained `sortField`,
  `moodAxisId`, and a promoted top-level `orderBy` (previously only a
  per-query param, not stored filter state) so the current sort survives
  path/view changes the same way other filters do.

## 3. Clickable tag stats in Analytics

`TagDistributionChart.tsx` already rendered a tag-frequency pie chart
(`server/routerTrpc/analytics.ts`'s `tagStats`) — it just wasn't clickable
and didn't carry a tag id.

- `analytics.ts`'s `tagStats` output gained `tagId: number | null` per
  entry (`null` for the synthetic "Others" bucket, which isn't a real tag).
- `TagDistributionChart.tsx` now attaches an echarts `click` handler; clicking
  a real slice (non-"Others") shows a small info bar below the chart — tag
  name + count — with a "View entries" button that navigates to
  `/?path=all&tagId=<id>`, the same filter route `TagListPanel`'s sidebar
  tree already used.

## 4. Structured mood scoring

Previously, "mood" only existed as free-text `#mood/*` tags the AI happened
to generate (see `docs/workstreams/04-ai-pipeline.md`,
`docs/workstreams/08-analytics-view.md`, and
`docs/workstreams/09-entry-personalization.md` §1h/§3.7, all written before
this workstream and now stale on this specific point — corrected below).
This workstream adds a real, structured, numeric mood model alongside that
existing tag-based signal (the two are complementary, not redundant: tags
stay free-text/open-ended, mood axes are fixed-vocabulary and 0-100 scored,
which is what makes "sort by mood" and future mood-trend charts possible).

**Schema** (`prisma/schema.prisma`, migration
`prisma/migrations/20260910191828_add_tag_features/migration.sql`):
- `notes.contentLength Int` — Postgres **generated column**
  (`GENERATED ALWAYS AS (char_length(content)) STORED`), never written to by
  app code, used only for the size sort in §2.
- `notes.aiTaggedAt DateTime?` — null means "AI tagging/mood-scoring has
  never run for this note," the marker the backfill job in §5 keys off.
- `notes.moodScores Json? @db.JsonB` — per-note scores, keyed by
  `moodAxis.id` as a string (JSON keys are always strings), e.g.
  `{"1": 72, "2": 40}`. `jsonb`, not `json`, specifically so it can be
  ordered by a JSON path (§2).
- New `moodAxis` model: `positiveLabel`, `negativeLabel` (nullable —
  bipolar axes like valence set both; unipolar intensity axes like "joy"
  leave it null), `sortOrder`, `accountId`. Structurally a near-copy of the
  existing `tag` model's shape/FK convention.

**Default axes** (`prisma/seed.ts`'s new `seedDefaultMoodAxes()`, same
idempotent "only seed if the account has zero rows" pattern as
`seedDefaultAiConfig`): one bipolar **valence** axis
(`positive`/`negative`) plus eight unipolar intensity axes — **anger,
anxiety, joy, sadness, surprise, fear, excitement, gratitude** — a standard
basic-emotions/affective-computing set, given verbatim by the user rather
than invented here.

**AI scoring** (`server/aiServer/aiModelFactory.ts`'s new `MoodAgent`,
following the exact plain-text-output `#createAgentFactory` convention
`TagAgent`/`EmojiAgent` already use — no JSON mode anywhere in this file):
given the active axes (formatted `positiveLabel/negativeLabel` for bipolar,
just `positiveLabel` for unipolar) and the entry content, returns
`label:score` comma-separated pairs, 0-100 (50 = neutral for bipolar, 0 =
absent for unipolar). Parsed and clamped in `AiService.scoreMood()`
(`server/aiServer/index.ts`).

**Manage axes**: `app/src/components/BlinkoSettings/AiSetting/MoodAxisSection.tsx`
(added to `AiSetting.tsx` next to the AI Post-Processing section) — add
(bipolar or unipolar)/rename/delete, backed by new `moodAxisCreate`/
`moodAxisUpdate`/`moodAxisDelete`/`moodAxisList` procedures in
`server/routerTrpc/ai.ts`. This is how the user extends the seeded set
later (e.g. adding a "calm/energetic" axis) without a code change.

## 5. AI tagging audit (backfill)

Refactored the tag-generation logic that used to live only inline in
`AiService.postProcessNote`'s `'tags'`/`'both'` branch
(`server/aiServer/index.ts`) into two reusable static methods —
`AiService.suggestTags(content)` and `AiService.scoreMood(content)` — so a
background job with no live tRPC `Context` can call the exact same logic a
live note-creation request does. `postProcessNote` now also calls
`scoreMood` and sets `aiTaggedAt` after both tags and mood scoring
complete for the `'tags'`/`'both'` modes.

The hashtag-content-sync logic `note.ts`'s `upsert` used to run inline
(parsing `#tag` out of content, reconciling `tag`/`tagsToNote` rows) was
likewise extracted into `syncNoteTagsFromContent(noteId, accountId, content)`
in `server/lib/helper.ts` — both note-creation and note-update call this one
function now instead of two near-duplicate inline blocks, and it's what the
backfill job calls directly (via `prisma`, no `Context`/`userCaller` needed —
the same reason the pre-existing `RebuildEmbeddingJob` calls
`AiService.embeddingUpsert` directly instead of going through
`caller.notes.upsert`).

**New job** `server/jobs/tagAuditJob.ts` (`TagAuditJob`), modeled directly on
`server/jobs/rebuildEmbeddingJob.ts`'s shape (resumable, stoppable, batched
5-at-a-time, progress in the `cache` table, retry-failed support) plus its
own daily cron (`0 3 * * *`, registered in `server/index.ts`'s
`initializeJobs()` alongside the other scheduled jobs — so untagged notes
get swept up automatically overnight, not only on manual trigger). Selects
`notes.findMany({ where: { aiTaggedAt: null, isRecycle: false } })`.

**tRPC procedures** (`server/routerTrpc/ai.ts`): `tagAuditStart`,
`tagAuditResume`, `tagAuditRetryFailed`, `tagAuditStop`, `tagAuditProgress`,
plus `tagAuditPendingCount` (a quick "N notes need tagging" count shown
before the user starts a run).

**UI**: `app/src/components/BlinkoSettings/AiSetting/TagAuditSection.tsx`
(added to `AiSetting.tsx`) + `app/src/components/Common/TagAuditProgress/index.tsx`
(the progress dialog), following `EmbeddingSettingsSection.tsx`'s existing
2-second-poll-while-running pattern exactly.

## 6. Tagging prompt: added topic/theme category

`prisma/seed.ts`'s `journalTagsPrompt` (seeded as `aiTagsPrompt`, see
`docs/workstreams/04-ai-pipeline.md`) covered four categories: people,
places, mood, occasion. Added a fifth: **topic/theme** — the subject the
entry is mainly about — `#theme/work`, `#theme/relationships`,
`#theme/health`, `#theme/finances`, `#theme/creative`,
`#theme/personal-growth`. Also loosened rule 4's generic-tag denylist
slightly (`#work`/`#reference` were previously blocked outright; now theme
tags cover that ground properly instead).

**Gotcha**: this only takes effect via `setConfigIfMissing`, which does not
retroactively overwrite an already-seeded `aiTagsPrompt` row. If the remote
server has already booted once (i.e. already has a `config` row for this
key), the new category needs to be picked up either by clearing that one row
before the next deploy, or by pasting the updated prompt (§ above, or
`prisma/seed.ts`'s `journalTagsPrompt`) directly into Settings → AI → AI
Post Processing → Tags Prompt.

## 7. Create and manage tags directly

Previously tags could only be created implicitly by typing `#hashtag` into a
note's content — there was no "create a tag with zero notes attached yet"
path.

- New `tags.create` procedure (`server/routerTrpc/tag.ts`): `{ name, icon?,
  parent? }`, account-scoped, rejects a duplicate name at the same parent
  level. Rename/delete/reorder/icon-change already existed via
  `TagListPanel.tsx`'s context menu — untouched.
- New `app/src/components/Common/CreateTagPop/index.tsx`
  (`ShowCreateTagDialog`), opened from a new "+ New Tag" affordance added to
  `TagListPanel.tsx`'s header (the sidebar tag tree). No new page — this
  lives right alongside the tree it populates.

## 8. Manual tag attach/detach on any entry

Previously the only way to add/remove a tag on an existing entry was to
hand-edit `#hashtag` text into its content. Tags stay **100% content-derived**
(`syncNoteTagsFromContent`, §5) — so the fix here is a UI that manipulates the
same `#path` hashtag in `content`, not a shortcut that writes `tagsToNote`
rows directly (which the next content save would silently undo).

- **Backend**: `tag.attachToNote`/`tag.detachFromNote`
  (`server/routerTrpc/tag.ts`) — `{ noteId, tagPath }`, fresh-reads the
  note's content, appends/strips the `#path` hashtag via regex, then calls
  `syncNoteTagsFromContent`.
- **Shared UI**: `app/src/components/Common/TagPicker/index.tsx` — chips for
  current tags (removable) + a "+" trigger opening a HeroUI `Autocomplete`
  (backed by `blinko.tagList.value?.pathTags`, `allowsCustomValue` so typing
  a new path and hitting Enter creates it).
- **Three surfaces wired to it**:
  1. `TagList` (§1)'s note cards — pass `noteId`, calls the mutations
     directly + `blinko.forceQuery++`.
  2. `BlinkoRightClickMenu` — new "Add Tag" item (desktop context menu +
     mobile dropdown) opens a dialog wrapping `TagPicker`, computing current
     tags from `blinko.curSelectedNote?.tags`.
  3. **The editor itself** — a "Tags" row above the toolbar, both composing
     (`mode='create'`) and editing an existing entry. Not content-derived
     live in the visible markdown body (that was considered and rejected as
     too risky given the untraced vditor initial-value pipeline); instead
     `EditorStore` holds `tags`/`initialTags` (a snapshot taken on load), and
     `handleSend()` diffs them against `content` at send time — an added tag
     becomes a trailing `#path` (skipped if already literally present in the
     body), a removed tag's hashtag gets stripped out. Wired in
     `useEditor.ts`'s create/edit-mode init and `Editor/index.tsx`'s
     `renderTagsRow()`.

## On the DB being on a separate VM / migration safety

Every schema change here is additive only (`ADD COLUMN`, one `CREATE
TABLE`) — nothing drops, renames, or alters existing data, so no backup was
needed before writing the migration. It rides the same mechanism every
prior migration in this repo already uses: `dockerfile`'s `start.sh` runs
`npx prisma migrate deploy` → `node server/seed.js` → `node server/index.js`
on **every container start**, against whatever `DATABASE_URL` points to
(the separate Postgres VM). No new deploy wiring was needed for this
workstream — the new migration and the new `seedDefaultMoodAxes()`/updated
`journalTagsPrompt` seed step both just ride that existing boot sequence.

## Files touched

Backend: `prisma/schema.prisma`, `prisma/migrations/20260910191828_add_tag_features/`,
`prisma/seed.ts`, `shared/lib/prismaZodType.ts` (added `contentLength`/
`aiTaggedAt`/`moodScores` to `notesSchema`, added `moodAxisSchema` —
zod-prisma-types generation is commented out in `schema.prisma`, so this
file is hand-maintained, not auto-generated), `server/lib/helper.ts`
(`extractHashtags`, `syncNoteTagsFromContent`), `server/aiServer/aiModelFactory.ts`
(`MoodAgent`), `server/aiServer/index.ts` (`suggestTags`, `scoreMood`,
`postProcessNote` wiring), `server/jobs/tagAuditJob.ts` (new),
`server/index.ts` (job registration), `server/routerTrpc/note.ts`
(`sortField`/`moodAxisId`, tag-sync refactor), `server/routerTrpc/tag.ts`
(`create`, `attachToNote`/`detachFromNote`, §8), `server/routerTrpc/analytics.ts`
(`tagId` on `tagStats`), `server/routerTrpc/ai.ts` (`tagAudit*`, `moodAxis*`).

Frontend: `app/src/components/Common/TagList/index.tsx` (new),
`app/src/components/Common/TagPicker/index.tsx` (new, §8),
`app/src/components/Common/CreateTagPop/index.tsx` (new),
`app/src/components/Common/TagAuditProgress/index.tsx` (new),
`app/src/components/BlinkoSettings/AiSetting/TagAuditSection.tsx` (new),
`app/src/components/BlinkoSettings/AiSetting/MoodAxisSection.tsx` (new),
`app/src/components/BlinkoSettings/AiSetting/AiSetting.tsx`,
`app/src/components/BlinkoCard/cardFooter.tsx`,
`app/src/components/BlinkoCard/cardBlogBox.tsx`,
`app/src/components/Common/TagListPanel.tsx`,
`app/src/components/Common/PopoverFloat/filterPop.tsx`,
`app/src/components/BlinkoAnalytics/TagDistributionChart.tsx`,
`app/src/pages/index.tsx`, `app/src/store/blinkoStore.tsx`,
`app/public/locales/en/translation.json` (English only, per this repo's
existing convention of not backfilling other locale files for new keys).

## Not done / to verify on the real host

- Prisma JSON-path `orderBy` for mood-sort (§2) — unverified, no live DB in
  this environment. Raw-SQL fallback path identified but not written unless
  actually needed.
- GPU/model-latency impact of `scoreMood` adding a second LLM call per note
  (alongside the existing tag-suggestion call) on `postProcessNote` and the
  backfill job — not measurable without the real Ollama instance;
  `docs/workstreams/04-ai-pipeline.md`'s shared-GPU capacity notes apply
  here too.
- No i18n beyond English, consistent with workstream 8's precedent.
- End-to-end verification checklist (do after deploy): tag chips + overflow
  popover render on ordinary (non-blog-mode) cards; the sort dropdown's
  mood options list the 9 seeded axes and actually reorder results; a tag
  slice click in Analytics shows the info bar and "View entries" navigates
  correctly; `tagAuditPendingCount` reports non-zero before a first run,
  zero after; a fresh note gets `aiTaggedAt`, `moodScores` (9 keys), and a
  `#theme/*` tag within seconds of creation; "+ New Tag" creates a
  zero-note tag that immediately appears in the sidebar tree and is usable
  as a filter/search target.
