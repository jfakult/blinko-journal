# Workstream 4 — AI Tagging, RAG Search & Location Logging

> **Update — see `docs/workstreams/10-tags-and-mood.md`.** The tagging
> prompt quoted below (§"Journal-appropriate auto-tagging prompt") is now
> stale — it's grown a fifth category (topic/theme) since this doc was
> written; the current text lives in `prisma/seed.ts`'s `journalTagsPrompt`.
> Mood is also no longer tag-only: a structured, AI-scored `moodAxis`/
> `notes.moodScores` system now runs alongside the `#mood/*` tags described
> here (both exist; they're complementary, not a replacement). The tagging
> audit/backfill job and `AiService.postProcessNote`'s exact tag-generation
> code path referenced below were also refactored — see workstream 10 for
> current file:line references.

Scope per the corrected brief (see `docs/PROJECT_BRIEF.md` and
`docs/workstreams/00-multi-user-model.md`): single account, single Ollama
instance. No multi-account provisioning here — just one account's AI
settings.

## Correction to the brief: auto-tagging is "AI Post-Processing," not "Scheduled AI Tasks"

The brief assumed automatic per-note tagging happens via Blinko's
**Scheduled AI Tasks** (a cron feature). That's wrong. Scheduled AI Tasks
(`server/routerTrpc/aiScheduledTask.ts`, `server/jobs/aiScheduledTaskJob.ts`,
`server/jobs/archivejob.ts`, `server/jobs/dbjob.ts`, etc.) are named/prompted
jobs an admin creates by hand and that run on a cron `schedule` string — they
are for things like periodic archiving/backups/digest-style summaries, not
"tag every note as it's created."

The feature that actually does automatic, no-click tagging on every note is
**AI Post-Processing**:

- **Trigger**: `server/routerTrpc/note.ts` — inside the note `create`
  mutation, after the note (and, if applicable, an async transcription) is
  written, there's:
  ```ts
  if (config?.isUseAiPostProcessing) {
    AiService.postProcessNote({ noteId: note.id, ctx }).catch(...)
  }
  ```
  This fires on every note creation automatically — no cron, no click. It
  also fires after transcription completes (the transcription branch above
  it kicks off the same async chain), so a voice memo gets tagged once its
  transcript lands.
- **Implementation**: `server/aiServer/index.ts`,
  `AiService.postProcessNote({ noteId, ctx })` (~line 351). Reads
  `AiModelFactory.globalConfig()`, checks `config.isUseAiPostProcessing`,
  then branches on `config.aiPostProcessingMode`:
  - `'comment'` — runs `config.aiCommentPrompt` through `CommentAgent()` and
    posts the result as a note comment authored by "Blinko AI".
  - `'tags'` — same idea but using `config.aiTagsPrompt`, and applies the
    result as tags (via the same tag-parsing path as `'comment'`/`'both'`
    handling further down in the function).
  - `'both'` — comment + tags.
  - `'smartEdit'` — requires a tool-calling-capable model.
  - `'custom'` — runs `config.aiCustomPrompt` (with `{tags}`/`{note}`
    variable substitution) through a tool-using agent that can create
    comments, update the note, or create new notes.
- **Settings surface**: global `config` table (see below), edited from the
  admin UI at Settings → AI → **AI Post Processing** card
  (`app/src/components/BlinkoSettings/AiSetting/AiPostProcessingSection.tsx`).
  There is no dedicated Prisma model for these settings — they're rows in
  the generic key/value `config` table.

**Cadence note (also corrects the brief):** because this is post-processing
on create/update, not a cron job, tags appear within seconds of note
creation (as soon as the Ollama call returns) — not "on a cron schedule."
The brief's Workstream 4 bullet "confirm the Scheduled Task cadence is
acceptable" doesn't apply; there's no cadence to tune for tagging.

## How global AI config is actually stored

`prisma/schema.prisma`:
- `model config { id, key, config: Json?, userId: Int? }` — one row per
  key. `userId: null` = global/admin config; `userId: <id>` = a
  per-user-preference row (see `ZUserPerferConfigKey` in
  `shared/lib/types.ts` for which keys are per-user vs. global). All the
  AI-provider and post-processing keys used here are global
  (`userId: null`), read via `getGlobalConfig()` in
  `server/routerTrpc/config.ts`.
- `model aiProviders { id, title, provider, baseURL, apiKey, config, sortOrder }`
  — one row per provider connection (e.g. one "Ollama" row with its
  `baseURL`/`apiKey`).
- `model aiModels { id, providerId, title, modelKey, capabilities, config, sortOrder }`
  — one row per model exposed by a provider, with a `capabilities` JSON
  flag set (`inference`, `tools`, `image`, `imageGeneration`, `video`,
  `audio`, `embedding`, `rerank`).

Relevant global `config` keys (all defined in `shared/lib/types.ts`
`ZConfigKey`/`GlobalConfig`):
- `mainModelId`, `embeddingModelId`, `voiceModelId`, `rerankModelId`,
  `imageModelId` — each points at an `aiModels.id`. **`embeddingModelId` is
  independent of `mainModelId`** — you can point chat at one
  `aiProviders` row/model and embeddings at a completely different one
  (different `baseURL`/`apiKey`), confirming the brief's assumption that
  the embeddings provider is separately configurable from the main
  chat/tagging model.
- `embeddingDimensions`, `embeddingTopK`, `embeddingScore` — RAG tuning.
- `isUseAiPostProcessing`, `aiPostProcessingMode`, `aiCommentPrompt`,
  `aiTagsPrompt`, `aiSmartEditPrompt`, `aiCustomPrompt` — AI Post-Processing
  settings described above.

## What's now defaulted in code (this branch)

`prisma/seed.ts` gained a new `seedDefaultAiConfig()` step, called from
`main()` (runs every container boot per the dockerfile's
`node server/seed.js`, same as the existing font-seeding step). It is
**non-destructive and idempotent**: it only acts if `aiProviders` has zero
rows, so it never overwrites an admin's already-configured providers.

When it does run, it seeds:
- One `aiProviders` row: `provider: 'ollama'`, `title: 'Ollama (local, journal default)'`.
- Two `aiModels` rows under it: a chat/tools model (`inference: true, tools: true`)
  and an embeddings model (`embedding: true`).
- Global `config` rows: `mainModelId` and `embeddingModelId` pointing at
  those two models, `isUseAiPostProcessing: true`,
  `aiPostProcessingMode: 'tags'`, and `aiTagsPrompt` set to the
  journal-appropriate prompt below.

**Everything above is controlled by env vars, with intentionally-obvious
placeholder fallbacks so a misconfigured deploy fails loudly instead of
silently doing nothing:**

| Env var | Default if unset | Notes |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://REPLACE_WITH_OLLAMA_HOST:11434` | **Must be set for real before first boot**, or fixed by hand afterward in Settings → AI → Providers. This repo/worktree has no visibility into the Unraid server's actual Ollama address — it's not part of this compose stack. Use `http://ollama:11434` if Blinko ends up sharing a Docker network with Ollama (coordinate with Workstream 7), or `http://<unraid-lan-ip>:11434` if not. |
| `OLLAMA_CHAT_MODEL` | `llama3.1` | Must actually be pulled on the target Ollama instance (`ollama pull llama3.1`) — check against whatever's already resident given the "shared GPU, check capacity" constraint in the brief. |
| `OLLAMA_EMBEDDING_MODEL` | `nomic-embed-text` | Same — must be pulled (`ollama pull nomic-embed-text`) and must match whatever `embeddingDimensions` logic in `server/aiServer/aiModelFactory.ts:rebuildVectorIndex` expects (that function already special-cases `nomic-embed-text` → 768 dimensions, so this default needs no manual dimension override; a different model will).

**Known gotcha to verify once deployed (not fixed here — behavioral change,
out of scope for a config-only branch):** in
`server/aiServer/providers/LLMProvider.ts`, the Ollama chat provider
auto-appends `/api` to `baseURL`. In
`server/aiServer/providers/EmbeddingProvider.ts`, the Ollama embedding
provider uses `baseURL` **as-is**, with no `/api` appended. If RAG
embedding calls 404, try setting `OLLAMA_BASE_URL` with `/api` already
appended (e.g. `http://ollama:11434/api`) for the embeddings path, or
confirm the installed `ollama-ai-provider` version's own default handles
it — this needs to be checked live post-deploy, which is out of scope for
this pure-config branch.

### Journal-appropriate auto-tagging prompt

Seeded as `aiTagsPrompt` by `seedDefaultAiConfig()`. If a fresh seed never
runs (e.g. the DB already has an `aiProviders` row from prior manual setup),
paste this exact text into **Settings → AI → AI Post Processing → Tags
Prompt** (visible when "AI Post Processing Mode" is set to "Auto add tags"
or "Both"):

```
You are tagging entries in a personal voice journal. Read the entry and suggest 3 to 6 tags that capture who, where, how the writer felt, and what kind of occasion this was. Rules:
1. **Categories to draw from**: people mentioned (by name or relationship, e.g. #people/mom, #people/sarah), places (e.g. #places/home, #places/lake-house), mood or emotional tone (e.g. #mood/grateful, #mood/anxious, #mood/excited, #mood/tired), and occasion or event type (e.g. #occasion/birthday, #occasion/milestone, #occasion/everyday, #occasion/trip).
2. **Reuse first**: prefer an existing tag from the provided tag list over inventing a new one, if it genuinely fits.
3. **New tags**: if nothing existing fits, create a new tag under one of the four categories above using the #category/value pattern.
4. **Avoid generic note-taking tags**: do NOT use tags like #todo, #idea, #project, #meeting, #work, #reference unless the entry is genuinely about work — this is a personal journal, not a notes app.
5. **Language**: match the language of the entry.
6. **Response format**: return only the tags, comma-separated, each starting with #, no spaces between tags, no explanation, no code blocks or Markdown. Example: #people/mom,#places/home,#mood/grateful,#occasion/everyday
```

Also set **AI Post Processing → Mode** to "Auto add tags" and toggle
**Enable AI Post Processing** on, if not already set by the seed.

## Location logging: brief's claim does not match the current code

The brief states Blinko has "native location tagging." **This is not
actually implemented anywhere in this codebase as of this branch** —
confirmed by exhaustive search:

- `prisma/schema.prisma`: `notes` has no dedicated location column — only
  a generic `metadata Json? @db.Json` field, confirmed. `metadata` is
  typed `z.any().optional()` end-to-end in the `upsertNote` mutation
  (`server/routerTrpc/note.ts`), so the backend will happily store
  whatever shape the frontend sends — but nothing currently sends
  location data into it.
- `app/src/components/BlinkoEditor/` and `app/src/components/BlinkoAddButton/`:
  no `navigator.geolocation` call, no `latitude`/`longitude`/`coords`
  handling anywhere. The only `metadata` writer found
  (`app/src/components/Common/Editor/editorStore.tsx`, ~line 225-250) is
  for **attachment** metadata on voice recordings (`isUserVoiceRecording`,
  `audioDuration`, `audioDurationSeconds`) — unrelated to note-level
  location.
- No EXIF/GPS extraction on image upload either (grepped for
  `exif`/`GPSLatitude`/`geoloc` across `server/` and `app/` — no matches
  outside vendored JS libraries).
- No `location` string appears anywhere in the locale files
  (`app/public/locales/en/`), so there's no hidden/unlabeled UI for it
  either.

**Net finding:** "location logging per entry" is a real gap, not a
config-tuning task. Building it (most likely: capture
`navigator.geolocation.getCurrentPosition()` in the editor at note-creation
time and pass `{ location: { lat, lng, accuracy, capturedAt } }` — or
similar — through the existing `metadata` field on `upsertNote`) is
frontend feature work, out of scope for this config-only branch. Flagging
here so Workstream 8 (analytics) doesn't assume a metadata shape that
doesn't exist yet, and so whoever picks this up next knows to build the
writer, not just a reader.

If/when that writer is built, the shape it chooses is what
`server/routerTrpc/analytics.ts` and any Workstream 8 dashboard component
must read from `notes.metadata` — there's nothing to "confirm" yet because
nothing writes it.

## RAG search / embeddings provider

- Provider selection logic: `server/aiServer/providers/EmbeddingProvider.ts`
  (`EmbeddingProvider.getEmbeddingModel`), switched on `provider.toLowerCase()`
  the same way as the chat/LLM provider (`server/aiServer/providers/LLMProvider.ts`).
  Confirms the brief's assumption: embeddings are configured via their own
  `aiProviders`/`aiModels` row (`embeddingModelId` in global config),
  independent of `mainModelId` — different `baseURL`/`apiKey` allowed.
- Vector store: LibSQL (`@mastra/libsql`), index name `'blinko'`, created by
  `AiModelFactory.rebuildVectorIndex()` in `server/aiServer/aiModelFactory.ts`.
  Dimension is auto-detected from known model-name substrings (includes
  `nomic-embed-text` → 768) or must be set manually via
  `embeddingDimensions` in `aiModels.config` (surfaced in the admin UI as
  Settings → AI → Embed Settings → Advanced Settings) if using an
  unrecognized model.
- Query path: `AiModelFactory.queryVector()` — `embeddingTopK` (default 3)
  and `embeddingScore` (default 0.4 minimum similarity) global config keys
  tune result count/relevance; both are admin-UI-only (no strong reason to
  seed non-default values, left as Blinko's defaults).

## What's now defaulted in code/seed vs. what still needs setting by hand after deploy

**Defaulted by `prisma/seed.ts` (`seedDefaultAiConfig`), once `OLLAMA_BASE_URL` etc. are set correctly:**
- Ollama provider + chat model + embedding model rows.
- `mainModelId` / `embeddingModelId` wired to those models.
- AI Post-Processing enabled, mode set to `'tags'`, journal tagging prompt set.

**Must be set by hand in the admin UI (Settings → AI) after deploy — nothing here can determine these from outside the Unraid host:**
1. Verify/correct the Ollama `baseURL` if the `OLLAMA_BASE_URL` env var
   wasn't set accurately before first boot (Settings → AI → Providers →
   edit the "Ollama (local, journal default)" provider).
2. Confirm `llama3.1` / `nomic-embed-text` (or whatever
   `OLLAMA_CHAT_MODEL`/`OLLAMA_EMBEDDING_MODEL` were set to) are actually
   pulled on that Ollama instance, and that the shared GPU has capacity
   (brief's constraint — coordinate with whatever else is using the same
   Ollama, e.g. Immich).
3. If embeddings 404 due to the `/api`-suffix gotcha noted above, fix the
   embedding provider's `baseURL` by hand.
4. `embeddingDimensions` — only needed if a different embedding model is
   substituted that isn't in the auto-detected list in
   `AiModelFactory.rebuildVectorIndex`.
5. Test end-to-end once real infra exists: create a note → confirm tags
   appear within seconds (AI Post-Processing) → confirm a natural-language
   RAG search returns it (brief's Workstream 4 acceptance checks) — not
   done here per instructions (no docker/bun/live testing in this branch).
6. Location logging is not implemented at all yet (see above) — this is
   new feature work for a future branch/workstream, not a setting to flip.
