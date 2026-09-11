# Workstream 11 — Audio Transcription, Background-Task Safety & AI Task Log

Not part of the original `docs/PROJECT_BRIEF.md` — like workstream 10, this is
later, separately-requested work done directly on `main`, no dedicated
branch. Covers: automatic Whisper transcription of voice-memo attachments,
hardening every AI background write against data loss/clobbering, a
paginated AI task log in Settings, a bug fix for the audio "Test Connection"
button, and the removal of the in-editor AI-writing assistant.

Status: **implemented, uncommitted on `main`** as of this writing — same
"code/config prep, verify on the real host" split as workstream 10.

## 1. Automatic audio transcription

Previously, an attached voice memo just sat there as an audio file — nothing
transcribed it into the entry's text automatically.

- **Model**: whatever AI provider is configured as the account's
  `voiceModelId` (Settings → AI → Default Models), via Mastra's
  `OpenAIVoice` (`server/aiServer/providers/AudioProvider.ts`). For a
  `'custom'`-type provider, `listeningClient` is overridden to a plain
  `OpenAI` client pointed at that provider's configured `baseURL` — this is
  what makes a self-hosted Whisper-compatible endpoint work, not just real
  OpenAI.
- **Trigger points** (`server/aiServer/index.ts`,
  `AiService.transcribeAndAppend({ noteId, accountId })`, ~line 789):
  - **Note create** (`server/routerTrpc/note.ts`): checks
    `hasPendingAudioTranscription(note.id)` synchronously right after
    insert; if true, transcription runs (async, unawaited by the mutation)
    and **only after it settles** (success or failure) does
    `postProcessNote` (tagging/mood) fire. This is the explicit gate so a
    voice-only entry never gets tagged against empty content.
  - **Note update**: if `voiceModelId` is configured, `transcribeAndAppend`
    also fires here now — previously only note *creation* ever triggered
    transcription, so attaching a voice memo to an *existing* entry (or via
    edit) silently never got transcribed. Update does **not** re-trigger
    `postProcessNote` (editing a note has never re-run AI tagging in this
    codebase, unchanged).
  - **`TagAuditJob`** (nightly backfill, see workstream 10 §5): checks the
    same gate per note before tagging, so old untagged voice-only entries
    get transcribed and then tagged, not tagged against empty content.
- **What happens to a transcript**: each pending audio attachment is sent to
  `processNoteAudioAttachments`, then **every attempted** attachment (not
  just successful ones) is marked `attachments.transcribedAt = now()` —
  deliberately, so one bad audio file can't block tagging forever or get
  retried every night. Successful transcripts are appended to `notes.content`
  under a `## Audio Transcription` heading (`## Audio Transcription 2`, `3`,
  … if multiple in one pass). Re-embeds the note afterward if
  `embeddingModelId` is configured.
- **New DB field**: `attachments.transcribedAt DateTime?`
  (`prisma/migrations/20260911171048_add_attachment_transcribed_at/`) — null
  means "not yet attempted." No column tracks transcript text separately; it
  only ever exists inline in `notes.content`.

**Known, accepted limitation — not fixed**: deleting an attachment and
re-uploading the *same* audio file produces a **second, duplicate**
`## Audio Transcription` block. Uploads are timestamp-suffixed
(`server/lib/files.ts`), not content-hash-deduped, so a re-upload is a brand
new `attachments` row with `transcribedAt: null` — indistinguishable from a
first-time upload — and attachment delete never touches the transcript text
already baked into `content`. Fixing this properly would mean
content-hashing uploads, judged out of scope for what's a minor annoyance,
not data corruption.

## 2. Hardening AI background writes (concurrency safety)

Every AI-driven write to a note happens **asynchronously, well after** the
request that triggered it returns — tag suggestion, mood scoring, and
transcription can each take several seconds. That's a real window for the
user to edit the same note in the meantime. Two problems existed:

1. **Clobber risk**: the tag-append path read `note.content` once, then
   (after the slow LLM call) wrote `oldContent + tags` back — silently
   overwriting any edit the user made in between. Transcription had a
   smaller version of the same gap.
2. **Invisible metadata mutation**: every background write also bumped
   `notes.updatedAt` (Prisma's `@updatedAt`), which reorders "recently
   updated" sort and makes it look like *you* touched the entry when only
   the AI did.

**Fix — compare-and-swap + preserved `updatedAt`** (`server/aiServer/index.ts`):

- `AiService.appendTagsIfUnchanged(...)` (~line 403): does
  `prisma.notes.updateMany({ where: { id, content: expectedContent,
  updatedAt: expectedUpdatedAt }, data: { content: newContent, updatedAt:
  expectedUpdatedAt } })` — only commits if *nothing* changed since the
  content was read before the LLM call. On a lost race it just **skips**
  (logs a warning) rather than clobbering; the note simply stays untagged
  and gets picked up by the next post-process pass or the nightly
  `TagAuditJob` — never data loss, only a deferred retry. Replaces the old
  `caller.notes.upsert(...)` call, which also had side effects inappropriate
  for an invisible background pass: a phantom `noteHistory` version entry
  and a webhook fire for every AI tag pass.
- `AiService.transcribeAndAppend(...)` (~line 789): same CAS idea, but
  **retries** (up to 5 attempts against freshly-read content) instead of
  skipping — because attachments are already marked `transcribedAt` before
  this write, a skipped transcript would be lost forever, not just
  deferred. In practice, for a single-user app, this is effectively
  always-succeeds; the retry ceiling only matters under pathological
  contention.
- Mood-score and `aiTaggedAt` writes don't touch `content` (no clobber risk)
  but now also explicitly pass `updatedAt: <the value read before the AI
  call>` so they don't silently bump it either.
- Applied identically in `server/jobs/tagAuditJob.ts`'s backfill loop.

None of this required a schema change — logic-only, no migration, no deploy
risk beyond the code itself.

## 3. AI Task Log

A new expandable, paginated log in Settings → AI showing what background AI
work has run and its outcome — previously there was no way to see whether a
given tag/mood/transcription pass actually succeeded short of grepping
server logs.

**Schema** (`prisma/migrations/20260911190000_add_ai_task_log/`, additive
only — new table, no risk to existing data): `aiTaskLog` — `taskType`,
`status` (`running` / `success` / `error` / `stopped`), `noteId`,
`accountId`, `message`, `startedAt`/`finishedAt`.

**Logging helper** (`server/lib/aiTaskLog.ts`): `logAiTaskStart`/
`logAiTaskFinish`, deliberately **best-effort** — wrapped in try/catch so a
logging failure can never interrupt or fail the AI operation it's
describing. Wired into:
- `postProcessNote` (one row per call, `taskType` implicit via message —
  covers comment/tags/smartEdit/custom modes)
- `transcribeAndAppend`
- `AIComment`
- `TagAuditJob` / `RebuildEmbeddingJob` — one row **per run** (start/resume/
  stop/finish), not per-note, since both jobs already have their own
  detailed per-note progress UI (workstream 10 §5); these log with
  `accountId: null` since they process every account's notes, not one.

**Deliberately not logged**: interactive chat completions and `relatedNotes`
— both are foreground, user-initiated, and already visible in the UI; the
task log is specifically for silent background work a user has no other way
to observe.

**Access control** (`server/routerTrpc/ai.ts`, `aiTaskLogList`, ~line 371):
reuses the existing `accounts.role === 'superadmin'` check already used
elsewhere in this codebase. A superadmin can pass `scope: 'all'` to see
every account's tasks; anyone else is **always** scoped to their own
`accountId` server-side regardless of what they request, not just hidden
client-side.

**UI**: `app/src/components/BlinkoSettings/AiSetting/AiTaskLogSection.tsx` —
a `CollapsibleCard` (the "expandable block") with a 20-per-page "Load more"
list, status icon, task type, a link to the note (opens it via the existing
`ShowCommentDialog`), relative timestamp, and duration. Superadmins get a
"My tasks" / "All accounts" toggle.

## 4. Audio "Test Connection" bug fix

Upstream Blinko's `testConnect` procedure (`server/routerTrpc/ai.ts`) tested
`inference` and `embedding` capabilities with a real round-trip call each,
but the `audio` branch was a stub: `throw new Error("audio cannot test")`,
unconditionally. Since this throw wasn't caught, it failed the **entire**
mutation (500, no per-capability detail) any time `audio` was one of the
capabilities being tested — this is what produced "Connection test failed:
audio cannot test" when testing the Whisper model.

**Fix**: the audio branch now does a real test, matching the other two —
builds the actual `AudioProvider` audio model (the same class production
transcription uses) and feeds it a tiny in-memory silent WAV
(`buildSilentWavBuffer()`, ~line 21 — 44-byte header + 0.1s of silence, no
user-supplied audio sample needed), wrapped in the same try/catch pattern as
`inference`/`embedding` so a failure reports per-capability instead of
failing the whole request. Success only means the API round-trip worked
(auth + `baseURL` reachable) — whisper likely transcribes silence as empty
text, and that's fine, same "did the call succeed" bar the other two use.

## 5. Filter/sort bar bug fixes (workstream 10 §2 follow-up)

Three bugs found after workstream 10 shipped, all in
`app/src/components/Common/PopoverFloat/filterPop.tsx` and
`app/src/hooks/useDragCard.tsx`:

- **Sorting appeared to do nothing**: two independent causes.
  1. `FilterPop`'s Apply/Reset always called `blinkoStore.noteList.resetAndCall()`
     — the `?path=all` list. The normal journal view is `?path=notes`
     (`noteOnlyList`, a *different* `PromisePageState`), so Apply was
     refetching a list nobody was looking at. Fixed with `getActiveList()`
     (~line 69), which resolves the actually-visible list from the current
     `?path=` the same way `blinkoStore.useQuery()`/`refreshData()` already
     do.
  2. Even with the right list refetched, `useDragCard` unconditionally
     re-sorted every note list by `sortOrder` (manual drag position),
     discarding whatever order the backend returned. Initially fixed via an
     `isCustomSort` check (bypass the `sortOrder` tie-break outside the
     default "Newest" view) — then superseded by removing drag-reordering
     entirely (below), which makes the whole tie-break moot: with no manual
     order to preserve, sort is the only ordering concept left.
- **"All N entries loaded" showing before the entries did**
  (`app/src/pages/index.tsx`): the message read `currentListState.isLoadAll`
  directly from the store, which flips true the instant fresh data arrives
  — but the cards on screen come from `useDragCard`'s `localNotes`, which
  syncs one render behind via a `useEffect`. Fixed by gating the message on
  `localNotes.length` actually matching the fetched count, showing a
  loading-spinner icon in the gap instead (`store.isSyncingList`).
- **UX**: the tag filter (`TagSelector`, already an autocomplete) is now
  always visible in the popup instead of hidden behind first picking "With
  Tags" from the Tag Status dropdown, plus an explicit clear (×) button;
  hidden only for "Without Tags" (a specific-tag search would contradict
  it). "Apply Filter" renamed to "Apply".

**Drag-to-reorder removed** (`app/src/hooks/useDragCard.tsx`): per explicit
follow-up request — sorting should be the only ordering concept, not a
separate manual drag-order that could silently fight with it. `shouldEnableDrag`
(previously `blinko.fullscreenEditorNoteId === null`, toggling drag off only
while the fullscreen editor was open) is now hardcoded `false`, so dnd-kit's
`MouseSensor`/`TouchSensor` activation constraints can never be satisfied and
drag can never start. Deliberately **not** a full rip-out of `DndContext`/
`useDraggable`/`handleDragStart`/`handleDragEnd`/`handleDragOver` — those all
become dead-but-harmless code paths (unreachable once no drag ever begins)
rather than a larger, riskier refactor for the same net effect. `notes.sortOrder`
(the DB column) and `updateNotesOrder` (the tRPC mutation) are both left in
place, just unused now — no migration, since nothing needs removing at the
schema level for this.

## 6. AI Write assistant removed

The in-editor "AI Write" feature (generate/expand/polish entry text via an
LLM, inserted directly into the note) went against this journal's
philosophy — entries should be the user's own words, voice-transcribed or
typed, not AI-authored. Removed both surfaces:

- The toolbar icon (`AIWriteButton`, was conditionally shown in
  `app/src/components/Common/Editor/index.tsx` whenever `mainModelId` was
  configured) — component deleted entirely
  (`app/src/components/Common/Editor/Toolbar/AIWriteButton/`).
- `AiWritePop` (`app/src/components/Common/PopoverFloat/aiWritePop.tsx`,
  mounted globally in `Layout/index.tsx`), a text-selection-triggered
  version of the same feature via `showAiWriteSuggestions()`/an
  `aiwrite:update` event — also deleted. This was already unreachable in
  practice (nothing in the app called `showAiWriteSuggestions`), but left
  the same generate-into-entry capability wired up globally, which
  contradicts the point of removing the toolbar button.

**Left in place, deliberately**: `AiStore`'s underlying `writeStream`/
`isWriting`/`writingResponseText`/etc. fields (`app/src/store/aiStore.tsx`)
— removing those too would be a larger, unrelated refactor for no
functional benefit (nothing calls them anymore; an inert store field costs
nothing). If a future pass wants to fully strip the AI-write plumbing, that
store is where to look.

## Not done / to verify on the real host

- Whisper transcription end-to-end: attach a voice memo, confirm the
  transcript appends under `## Audio Transcription` and tagging/mood-scoring
  runs only after (not against empty content).
- The CAS-retry logic in `transcribeAndAppend`/`appendTagsIfUnchanged` —
  unverified against a live DB (no concurrent-write test harness in this
  environment); reasoning verified by code review only.
- Audio "Test Connection" — click Test on the whisper model and confirm it
  now reports a real pass/fail instead of the generic 500.
- AI Task Log — confirm rows appear for a live tag/transcription/comment
  pass, pagination works past 20 rows, and the superadmin "All accounts"
  toggle is actually gated (a non-superadmin account should never see it).
- Filter/sort bar — confirm each non-default sort (oldest, longest,
  shortest, each mood axis) actually reorders the `?path=notes` view, pinned
  notes still float to top under a custom sort, and the "all N loaded"
  spinner-then-text transition is smooth (not a visible flash) on a normal
  connection.
