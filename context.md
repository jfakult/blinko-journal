# context.md — read this first

Fast-orientation doc for an AI coding assistant working in this repo. Skim it, then go read the specific files it points to. Where this conflicts with older docs (`docs/PROJECT_BRIEF.md`, per-workstream docs), **this file and the code win** — those are historical.

## What this is

`blinko-journal` is a fork of [blinkospace/blinko](https://github.com/blinkospace/blinko) (AGPL-3.0, upstream remote = `upstream`) turned into a **private, self-hosted, voice-first journal**. Users record or type entries; the server transcribes audio (Whisper), auto-tags, scores mood, embeds into a RAG index, and offers AI chat over the user's own entries. Hard constraint: **all AI is self-hosted** (Ollama + Whisper-compatible service) — nothing may call a cloud AI provider.

- Deployed at `fakult.net/journal` on a home Unraid server; SSO via Pocket-ID, shown on the login page as "Login with FakNet". A `guest`/`guest` account exists for a "just checking it out" login link.
- **It is multi-user now.** `docs/PROJECT_BRIEF.md` says single-user; that's outdated. There's a superadmin, regular users, and a guest. Data is per-account (`accountId` scoping everywhere); RAG/chat must never read another user's notes.
- UI vocabulary: "Entries" (not "Notes"), "Quick Entry" for the old Blinko type. Only `NoteType.NOTE` is used — the "blinko"(quick-capture) and "todo" types are hidden from nav.

## Stack & layout

Monorepo, Bun (v1.2.8+) package manager/runtime, Turbo. React 18 + Vite + Tailwind + HeroUI + MobX frontend; Express + tRPC + Prisma + PostgreSQL backend; Mastra + Vercel AI SDK for agents; LibSQL vector store (`@mastra/libsql`, single global index `blinko`); pg-boss for scheduled jobs; Vditor markdown editor; Tauri wrapper exists upstream but isn't used here.

```
app/src/            React frontend
  pages/            route pages (index.tsx = entry feed, settings.tsx, analytics.tsx, ai.tsx, signin.tsx, ...)
  components/       BlinkoCard, BlinkoEditor, BlinkoRightClickMenu, BlinkoSettings/AiSetting/*, Common/*, ...
  store/            MobX stores: blinkoStore.tsx (lists/filters/upsert), baseStore.ts (nav), user.ts, aiSettingStore, standard/PromiseState.ts
  hooks/useDragCard.tsx   sorts the feed (drag-reorder itself is disabled)
  lib/tauriHelper.ts      mic permission helpers etc. (despite the name, used on web)
app/public/locales/en/translation.json   all UI strings (i18next)
server/
  index.ts, context.ts, prisma.ts
  routerTrpc/       tRPC procedures: note.ts, ai.ts, config.ts, tag.ts, analytics.ts, conversation.ts, user.ts, ...  (_app.ts = root router)
  routerExpress/    REST: file/ (upload + range-request serving), auth/, mcp.ts, openai.ts, rss.ts
  aiServer/         index.ts (AiService), aiModelFactory.ts, providers/, tools/, mcp/
  jobs/             pg-boss jobs: tagAuditJob, rebuildEmbeddingJob, purgeTrashJob, dbjob (backup), aiScheduledTaskJob, ...
  lib/              helper.ts (tag sync), aiTaskLog.ts, files.ts (FileService), pgBoss.ts
  middleware/       authProcedure, superAdminAuthMiddleware
shared/lib/         types.ts (config key schemas), prismaZodType.ts (tRPC output schemas), helper.ts
prisma/             schema.prisma, migrations/ (hand-written SQL), seed.ts
plugins/journal-declutter/   CSS-only plugin hiding irrelevant upstream UI (.cj-hide-* selectors)
scripts/            local_dev.sh, build_local.sh, check-upstream.sh, sync-upstream.sh
docs/               PROJECT_BRIEF.md, deployment-checklist.md, workstreams/NN-*.md (historical design notes; 10 and 11 are the most current)
todo.txt            owner's rough roadmap
```

`CLAUDE.md` = upstream-generic guidance (still accurate for commands). This file = fork-specific.

## The `CUSTOM-JOURNAL` convention

Every deliberate deviation from upstream is marked with a `// CUSTOM-JOURNAL:` comment that explains **why** (and what it replaced). Keep doing this: when you change behavior, add one. It's how the owner finds our changes during upstream merges (`scripts/sync-upstream.sh`). Prefer minimal, isolated edits over refactors of upstream code. `grep -rn CUSTOM-JOURNAL app/src server shared prisma` shows the whole fork delta.

## Running & deploying

**Local dev (no Docker, hot reload):** `./scripts/local_dev.sh {start|stop|status|restart|logs}` → http://localhost:1111 (Vite runs in Express middleware mode; one port). Log: `/tmp/blinko-journal-dev.log` (overwritten each start). Header of that script documents what needs a restart.
- `.env` (gitignored) points `DATABASE_URL`/`OLLAMA_BASE_URL` at **real remote infra over Tailscale — a real seeded DB, not a sandbox.** Never run `prisma migrate dev`/`reset`. Read-only `psql` inspection is fine.
- Frontend (`app/src`) hot-reloads. Backend/shared/`prisma/seed.ts` auto-restart via `bun --watch`. `.env` and Prisma-client regeneration need `restart`.
- Ad-hoc scratch scripts: `cd server && bun --env-file ../.env path/to/script.ts` (NOT `bun run script.ts` — `run` treats it as a package script). Delete them afterward.
- The root `dev:backend`/`dev:frontend` scripts are broken locally (`dotenv-cli` missing); `local_dev.sh` bypasses them.

**Schema changes:** edit `schema.prisma` → hand-write `prisma/migrations/<timestamp>_<name>/migration.sql` → `bun run prisma:migrate:deploy` → `bun run prisma:generate` → restart.

**Deploy:** push to `main` → `.github/workflows/docker-build.yml` builds and pushes `ghcr.io/jfakult/blinko-journal:latest`. The server then pulls + restarts the container (Ansible/compose lives outside this repo; see `docs/deployment-checklist.md`). The image's `start.sh` runs `prisma migrate deploy` → `node server/seed.js` → `node server/index.js` on every boot, so migrations + seeding are automatic.

## Config system (easy to get wrong)

- Key/value rows in the `config` table. Key registries: `ZConfigKey` / `ZUserPerferConfigKey` / `ZConfigSchema` in `shared/lib/types.ts`.
- **Global keys** (admin-set, `userId: null`): model IDs, prompts, RAG metadata toggles, etc. `config.update` rejects non-superadmin writes to them server-side.
- **Per-user keys** (`ZUserPerferConfigKey`): includes the four AI toggles `isEnableAiFeatures`, `isUseAiPostProcessing`, `isUseAiTranscription`, `isShowAiChatTab`. Rule of thumb from the owner: *users decide whether they use AI; the admin decides which models.*
- `getGlobalConfig` (`server/routerTrpc/config.ts`): non-superadmins only see their own rows plus an allowlist of global keys (`AUTHENTICATED_READABLE_GLOBAL_KEYS` — model IDs); per-user keys fall back to the seeded `userId: null` default when a user has no row. Server-side per-user resolution: `AiModelFactory.resolveEffectiveConfig(accountId)`; gate with `AiModelFactory.assertAiEnabled(config)`.
- **`config.list` has `.output(ZConfigSchema)` — Zod strips any key not in the schema.** A new config key must be added to `ZConfigKey` *and* `ZConfigSchema` or it silently never reaches the client. Same trap for other tRPC `.output()` schemas in `shared/lib/prismaZodType.ts`.
- Frontend convention for AI toggles: `value !== false` (unset = on). All AI feature switches default **on**.
- **`prisma/seed.ts` `main()` runs on every backend boot** (also as a side effect of importing `hashPassword`). `setConfigIfMissing(key, v)` only writes if no row exists (so editing a constant does nothing on an already-seeded DB); `forceSetConfigOnce(migrationId, key, v)` re-applies once per new, never-reused id. Use the latter to push a changed default.

## AI pipeline (server/aiServer/index.ts, `AiService`)

Order for a new/edited entry (`postProcessNote`, called from `routerTrpc/note.ts`): **transcribe audio → tags → mood → RAG embed**. Embedding deliberately runs *last* via `AiService.embedNoteWithMetadata` (prepends date/mood/tags per admin toggles) — also called at the end of `reanalyzeNote` (right-click "Re-run AI analysis"), on manual edits, and from `tagAuditJob`. Per-user vector filtering by `accountId` metadata; ownership is checked in `embeddingUpsert/Delete`. AI chat is per-user; the old "AI can edit notes" tools toggle was removed (`withTools: false` hardcoded server-side).

- **Transcripts** are written into note content as `## Audio Transcription (#<attachmentId>)` + a `> ` blockquote (detect/replace via `AiService.transcriptionBlockRegex`). Don't use HTML comment markers — Vditor's WYSIWYG round trip destroys them. Re-transcribing replaces in place.
- **Tags**: AI appends `#tag` text to content (`appendTagsIfUnchanged`, CAS retry loop) then `syncNoteTagsFromContent` (`server/lib/helper.ts`) reconciles `tag`/`tagsToNote` rows. Tags with `/` are hierarchical. Manual edits go through `routerTrpc/tag.ts` (`attachToNote`/`detachFromNote`), same sync.
- **Background writes must not clobber user edits or bump "recently updated":** they use compare-and-swap on `content`+`updatedAt` and preserve `updatedAt`. Explicit user actions (manual Transcribe, Re-run analysis) *do* bump it.
- **Failures must be visible:** every AI action writes an `aiTaskLog` row (`server/lib/aiTaskLog.ts`: `logAiTaskStart/Finish`, per-call `callAgentWithLog`). Shown in Settings → AI → task log, RAG history (`taskType: 'embedding'`), and the right-click **Info** popup. Don't swallow errors into `console.error` only.
- Mood: `moodAxis` rows (admin-defined, seeded) → scores in `notes.moodScores`. `notes.embeddedAt` = when last RAG-indexed. `notes.aiTaggedAt` = post-processing done.
- Jobs (pg-boss, `server/jobs/`): nightly tag audit/backfill (also finds transcription gaps), embedding rebuild, trash purge (recycle bin auto-deletes after N days), DB backup.

## Frontend notes

- **Feed list state:** `PromisePageState` (`store/standard/PromiseState.ts`) per list (`noteOnlyList` is the default "Entries" view; `?path=notes|all|trash|...`). Filters live in `blinkoStore.noteListFilterConfig` (single source of truth; mutate via `applyFilter`/`updateTagFilter`, not the URL). `useQuery()` handles URL → filter on cold load.
- **MobX gotcha (caused the long-running infinite-spinner bug):** `RootStore.Local(...)` = `useLocalObservable`, whose factory runs **once**. Getters inside it that close over React state/props go permanently stale. Compute values that depend on React state in the render body instead.
- Editor: `components/Common/Editor/editorStore.tsx`. `canSend` depends on Vditor content that isn't observable — `contentVersion` counter is bumped on input to force reactivity.
- Right-click/dropdown menus: `BlinkoRightClickMenu/index.tsx` (desktop `ContextMenu` + mobile `Dropdown` variants — edit **both**). "Edit Tags" dialog uses `Common/TagPicker` with optimistic removal.
- Settings → AI tab (`BlinkoSettings/AiSetting/`) is visible to everyone; global/admin sections are gated by `user.isSuperAdmin` in `AiSetting.tsx`. Mood axes, MCP, providers/models, prompts = admin only. RAG index stats/toggles admin only; RAG + AI task *history* visible to all (own entries; admins get a mine/all switch).
- Note-id links in logs open `ShowNotePopup` (`BlinkoCard/showNotePopup.tsx`); `ShowCommentDialog` is for comments only.
- Attachments: `HandleFileType` (`Common/Editor/editorUtils.tsx`) maps DB `Attachment` → render `FileType` — keep `metadata` (voice duration lives in `attachments.metadata.audioDuration[Seconds]`). Audio UI: `Common/AttachmentRender/audioRender.tsx`; recorder: `Common/AudioDialog`, `Common/AudioRecorder`.
- Tailwind preflight resets `<button>` to `cursor: default` — add `cursor-pointer` to raw buttons. Use `useMediaQuery('(min-width: 768px)')` (`isPc`) as the mobile/desktop breakpoint.
- New user-facing strings → `app/public/locales/en/translation.json` (English only is maintained).

## Data model highlights (`prisma/schema.prisma`)

`accounts`, `notes` (content markdown, `type`, `moodScores`, `aiTaggedAt`, `embeddedAt`, soft-delete via `isRecycle`), `attachments` (+ `metadata` JSON, `transcribedAt`), `tag` + `tagsToNote` (composite PK `noteId,tagId`), `config`, `aiProviders`/`aiModels`, `moodAxis`, `aiTaskLog`, `conversation`/`message` (AI chat, per-user), `noteHistory`, `comments`, `plugin`, `mcpServers`.

## Security invariants

Every tRPC procedure touching notes/attachments/conversations/vectors must scope by `ctx.id` (IDOR fixes already made in `ai.ts` embedding procs and `conversation.ts` — don't regress). Use `authProcedure`; add `.use(superAdminAuthMiddleware)` for admin-only. `aiTaskLogList`/`aiTaskLogGet` ignore `scope:'all'` from non-admins. Never commit `.env` or credentials.

## Working agreements with this owner

- Commit only when asked; **no `Co-Authored-By` trailer**. Group commits by feature with descriptive multi-line messages. Work on `main` (the per-workstream branches in `README.md` are historical).
- When asked a question ("does X…", "why…"), answer — don't edit. When asked to fix, root-cause it; several bugs here took 5+ attempts because earlier fixes guessed. Reproduce/inspect real data (read-only `psql`, scratch script) before theorizing.
- Be brief in explanations; say plainly when something is unverified (no browser access from the CLI — UI changes can only be checked via HMR compile logs, so ask the owner to confirm visually).

## Roadmap (owner's `todo.txt`, unbuilt)

Sharing features; tags included in audio-transcription flow; rename tag audit → "AI Post-processing audit" running every incomplete stage (tags/transcription/mood/RAG); per-card processing-status icons next to the mood smiley; re-run all AI tasks on entry edit; weekly/monthly recap; more analytics; ideas: location, same-day-other-years, privacy statement, per-user-key encryption.
