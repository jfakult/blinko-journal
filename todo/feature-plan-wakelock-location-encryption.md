# Plan: wake lock, location tagging + heatmap, per-user encryption

## Context
Three features for blinko-journal, built in this order: (1) keep the screen awake while recording, (2) location tags + interactive location heatmap, (3) per-user encryption that admins cannot read but server-side AI can use while the user is "unlocked". Location is built first behind one accessor so encryption slots in later. Mark every deviation with `// CUSTOM-JOURNAL:`.

Line numbers below come from two exhaustive read-only audits and are approximate (±5). Files are under `server/` unless noted.

---

## Feature 1 — keep screen awake while recording
- New `app/src/hooks/useWakeLock.ts`: `navigator.wakeLock.request('screen')` while active; release on inactive/unmount; re-acquire on `visibilitychange` (browsers drop it when hidden). Feature-detect; fall back to `nosleep.js` where unsupported.
- Use in `components/Common/AudioDialog/index.tsx`, keyed to `mediaRecorder.state === 'recording'` (start effect at :139-218, stop :249-273, cancel :308-318).
- Fix existing gap in same file: unmount cleanup (:213-217) must stop the `MediaRecorder` + mic tracks (hook `AudioRecorder/hook.ts` has no cleanup; backdrop/Esc dismissal leaves the mic running) and clear the leaked 1 s timer.
- While recording, show a warning if `visibilitychange` hides the page ("recording may pause if you leave the app"); iOS/Android suspend MediaRecorder on background/manual lock and no web API prevents that.
- Tell the user: Wake Lock works on Chrome/Android and in installed PWAs on iOS 18.4+. On older iOS keep the app in the foreground and raise Auto-Lock time while journaling; don't lock the phone manually.

## Feature 2 — location tagging + heatmap
Storage `notes.metadata.location = { lat, lng, name?, cell }` (metadata is a Json column, no migration). `cell` = ~0.005° grid key so nearby entries merge.
- **Capture**: new `Common/Editor/Toolbar/LocationButton/` copying `PersonalizeButton`; register in `Common/Editor/index.tsx` (~:87-90). `navigator.geolocation` → `store.updateMetadata({location})` (`editorStore.tsx:99-119`, drafts already persisted). Optional per-user "tag location automatically" key (add to `ZUserPerferConfigKey` **and** `ZConfigSchema`, `shared/lib/types.ts`).
- **Names**: server tRPC proc → self-hosted **Nominatim** container (`GEOCODE_URL` env; `/reverse?lat&lon&format=jsonv2&zoom=16`, use suburb/city). User can edit the name; remember named places, suggest nearest. Fallback = rounded coordinate label. (Nominatim serves no tiles.)
- **Display**: chip in `BlinkoCard/cardFooter.tsx`; row in `BlinkoRightClickMenu/index.tsx` `InfoDialogContent` (~:479-510); strings in `translation.json`.
- **Heatmap**: new `analytics.locationPoints` proc (own `.output` schema, scoped to `ctx.id`, non-recycled) returning cells `{cell, lat, lng, name, count, noteIds[]}`; new `BlinkoAnalytics/LocationHeatmap` on `pages/analytics.tsx`. Tileless: echarts scatter/heat over a bundled offline world-outline GeoJSON, bubbles sized by count. Click a cluster → side list of its entries (`ShowNotePopup`, `BlinkoCard/showNotePopup.tsx:19`) + "view in feed".
- **Feed filter**: `location: {cell}` in `notes.list` input (`note.ts:20-43`) via `AND` (not `OR`, already used at :181/:184; use JSON-path filter); add to `noteListFilterConfig` + `hasActiveFilter` (`blinkoStore.tsx:107-143`).
- All location read/write goes through `lib/location.ts` (feature 3 adds encrypt/decrypt there). `analytics.ts:155-190` location SQL (`metadata->'location'->>'name'` group-by) is replaced by the same accessor.

---

## Feature 3 — per-user encryption

### Prerequisite: stable SSO identity (username rename breaks accounts today)
`handleOAuthCallback` (`routerExpress/auth/config.ts:67-76`) finds the account by `name = preferred_username` + `loginType: 'oauth'`; the stable OIDC `sub` (read at :446) is never stored. Renaming a user in Pocket-ID ⇒ next login creates a **new empty account** and orphans the old data. Encryption itself is unaffected (keys hang off `accountId`, wrapped by user-held secrets, never the username), but the user would land on the wrong account.
- Add `accounts.oauthProvider` + `accounts.oauthSub` (nullable, unique together; hand-written migration). Lookup order: by `(provider, sub)` first; else fall back to `name` and **backfill `sub`** on that match (existing users self-heal on their next login, so it must ship before anyone renames); else create. On a match by `sub` with a changed name, update `name`/`nickname`.
- Until that ships: renaming in Pocket-ID requires an admin to rename the matching `accounts.name` row in the DB first.
- Passkey slots use the account id (not username) as the WebAuthn user handle so renames never orphan credentials.
- Guard against SSO username collision/takeover: two Pocket-ID users can't share a `sub`, and a reused name won't match once `sub` is set.

### Who gets encryption
**SSO (`loginType: 'oauth'`) accounts only.** Local-login admins and `guest` stay unencrypted (enable option hidden for them). This removes the password-slot path; slots are passkey / passphrase / device / recovery only.

### Scope (per your decisions)
- **Encrypted**: `notes.content`, `notes.metadata.location`, attachment files, and `noteHistory.content` (it is a full copy of old content — must follow).
- **Stay plaintext** (keeps filtering/sort fast): createdAt/updatedAt, ids, flags (recycle/archive/public/share), tags + tag names, mood/sentiment scores, has-link/has-file/has-todo, length. Disclosed leak: tag names are derived from content.
- New plaintext derived columns written at save time (from plaintext, before encrypting): `plainLength` (replaces generated `contentLength`, migration `20260910191828_add_tag_features:4`, `schema.prisma:97-108`), `hasLink`, `hasTodo`. Backfilled during migration.
- **Recommended small extension (confirm)**: same envelope for parallel content copies — `comments.content`, `message.content`/`conversation.title`, `aiScheduledTask.lastResult` — and stop writing note text into `aiTaskLog.calls`/`cache` snippets/`notifications.content` (see sinks below). Without this the encryption is cosmetic.

### Threat model (say this in the UI)
Protects data at rest: DB dumps, `bak.json`/`.bko`, vector file, disk theft, admin browsing DB/files. Does **not** stop someone controlling the running server process while a user is unlocked (server must hold the key to run AI). The unlock window bounds that exposure.

### Existing tooling — evaluated
- `prisma-field-encryption` (47ng): transparent Prisma extension but single app-wide key (docs describe env-var key; no per-user key model I could find). Not suitable as-is.
- `pgcrypto`: key travels in SQL to the DB host (visible to logs/DB admin) — defeats the goal. `pgsodium`: Supabase marks it pending deprecation. Skip both.
- **Choice**: Node built-in `crypto` AES-256-GCM in our own thin layer. A Prisma `$extends` hook is *not* enough here: raw SQL sites (`randomNoteList`, analytics), compare-and-swap writes on raw content, nested `references.toNote.content` includes, and cross-account (shared) reads bypass it. Use explicit helpers instead (`decryptNotes(rows, accountId)` incl. nested references; `encryptForWrite`; `rawCas`), plus a test that greps the DB for plaintext.

### Keys, slots, lockout safety
- Per-user random 256-bit **DEK**, never changes on credential changes. Table `keySlots(accountId, id, type: passkey|passphrase|device|recovery, salt, wrappedDek, params, createdAt)` (LUKS-style).
- KEK derived **in the browser** (WebCrypto): passphrase → Argon2id/scrypt (not the 1000-iteration pbkdf2 in `prisma/seed.ts:8-30`); passkey → WebAuthn PRF on our own origin (one biometric tap); optional **device slot** (non-extractable key in IndexedDB, opt-in per device → silent unlock on trusted devices); **recovery key** shown once.
- "SSO gives us a secret?" — no: anything Pocket-ID hands the server is also visible to the server, so a derived key would be admin-recoverable. A user-held secret (passkey/passphrase/recovery) is required for SSO users.
- **Cannot-lose-data rules**
  1. Setup requires ≥2 independent slots and a confirmed recovery key (user must re-enter it); last slot can't be deleted.
  2. Changing a passphrase/passkey touches only its own slot; other slots still work; DEK untouched. Pocket-ID username/passkey changes don't matter (nothing is derived from them).
  3. Changing a slot while unlocked needs no old secret (the unlocked session proves possession) — "forgot passphrase but still unlocked on a device" is fully recoverable.
  4. Slot swap = insert new + delete old in one Postgres transaction; a crash leaves the old slot valid. No bulk re-encryption on any credential change.
  5. Backups include slots, and the DEK never rotates in normal operation, so an old DB backup's slots still unwrap current data. DEK rotation (rare, admin-initiated) uses per-row version prefix (`enc:v2:`), resumable and idempotent.
  6. Migration/enable is per-row atomic and idempotent (`enc:v1:` prefix = encrypted); a crash just resumes; file re-encryption = write temp then rename/CopyObject.
  7. Honest limit: for SSO users, logging in alone can't decrypt; they need any one slot (passkey, passphrase, trusted device, or recovery key). Forgot everything and no recovery key = unrecoverable by design. Optional opt-in **admin recovery escrow** (DEK wrapped to an admin-held recovery public key) exists for users who prefer recoverability over admin-blindness; default off, clearly labelled.

### Unlock window + AI access
- Browser unwraps DEK, calls `crypto.unlock` (TLS) with chosen window. Server holds DEK **only in process memory** (`lib/keyring.ts`: `Map<accountId,{dek,expiresAt}>`, 32 bytes each — RAM is not a concern for keys). Restart = locked; users re-unlock.
- Window setting: **1 hour / 6 hours / 1 day / 3 days / 1 week / 1 month** (default 6 hours), sliding on user activity, with the warning that longer windows let the server decrypt your entries for background AI for that long. Explicit logout zeroes the key. The 30-day JWT (`lib/helper.ts:183`) no longer implies key access.
- Single choke point `keyring.require(accountId, reason)` → throws `Locked`; every background decrypt writes an `aiTaskLog` row with reason (no content).
- Locked behavior: entries whose AI stages didn't finish stay pending (`aiTaggedAt`/`embeddedAt` null); **backlog runs automatically on next unlock**. Nightly jobs iterate only currently-unlocked users. API/MCP bearer tokens (100-year `generateApiToken`, `helper.ts:168`) get 423 when locked.

### RAM / scale rules (GBs of history)
- Never load all notes: reads are paginated and decrypt only the returned page; jobs use **keyset pagination** (`id > cursor`, `take` 50-200), one unlocked account at a time; exports stream (NDJSON/streaming zip) instead of `AdmZip`/one-array `findMany`.
- Predicates that need no content use plaintext columns (`aiTaggedAt`, `tagsToNote`, `transcribedAt`, `moodScores`, `hasLink`, `hasTodo`) so audits decrypt only the notes that actually need work.
- **Search** (text + tags only): tags/date/flags filter in SQL first; then text match by streaming keyset batches (e.g. 200 rows), decrypt, match, early-stop when the page is full; cap rows scanned / time budget with a "narrow by date" hint. AES-GCM decrypt is far faster than the DB read, so cost is I/O, bounded by the cap. Locked ⇒ text search unavailable. Optional later: HMAC keyword blind index if scans get slow.
- **RAG**: keep it. `metadata.text` in the vector store is **never read back** (`queryVector` refetches from Postgres by id) — drop it (`aiServer/index.ts:173,243`); retrieval then decrypts only top-K notes. No perf hit, so no reason to leave plaintext. Embedding vectors still leak coarse semantics (disclose). If it ever proves slow, revisit per your rule.
- Files: chunked AES-GCM (64 KiB chunks, per-file random data key in header wrapped by DEK, last-chunk flag in AAD, path/name NOT in AAD so rename/move stay valid); plaintext size derivable from ciphertext length, `attachments.size` stays plaintext bytes. Range requests map plaintext range → chunk-aligned ciphertext range. Whisper `listen()` accepts any async iterable, so no temp file.

### Change list (dense)

**Crypto core (new)**: `lib/keyring.ts`, `lib/crypto/{envelope,stream,noteCrypto}.ts` (`enc:v1:` string envelope AAD=`accountId|table.column`; chunked stream Transforms; `decryptNotes` incl. nested `references.toNote/fromNote`; `rawCas`), `routerTrpc/crypto.ts` (setup, unlock, lock, list/add/remove slots, set window, migrate), `prisma/schema.prisma` + hand-written migration (`keySlots`, `plainLength`, `hasLink`, `hasTodo`, `attachments.encrypted`, widen `conversation.title`), `shared/lib/{types,prismaZodType}.ts` (new config keys in `ZConfigKey` **and** `ZConfigSchema`; output schemas), frontend `app/src/lib/crypto.ts` (WebCrypto, PRF, IndexedDB device key), Settings → Security UI, unlock prompt, `translation.json`.

**routerTrpc/note.ts**
- :129-148 search `contains` → keyset decrypt-scan; :180-190 `withLink`/`hasTodo` → new columns (also `hasTodo` clobbers `where.OR`, existing bug); :194 size sort → `plainLength`.
- :213-268 `list`, :405-450 `listByIds`, :643-690 `detail` (+ internal share reads other account's note), :698-712 `dailyReviewNoteList`, :1296-1350 `noteReferenceList`, :1417-1495 history/version → decrypt content + `metadata.location` + nested reference content.
- :731-761 `randomNoteList` raw SQL `SELECT n.*` + manual mapper → decrypt in mapper.
- :816-840 `relatedNotes` (2000 chars to LLM; drop `console.log` :836).
- :855-1240 `upsert`: encrypt content (:938) and create (:1082-1093); metadata merge (:944-957) must decrypt/merge/re-encrypt `location`; **:973 change detection compares content — compare plaintext or a history row is written on every save**; history copy (:980-995); tag sync (:1007,:1094) uses plaintext; write `plainLength/hasLink/hasTodo`; return decrypted note (`.output(z.any())`); embed/AI kick-offs :1100-1140 need key check.
- Webhooks `SendWebhook` :1004,:1078,:1176,:1782 send full note incl. content → ids only for encrypted accounts.
- :305-345 `publicList` (+ cache key ignores page/size/search), :513-560 share view, :1183-1215 `shareNote`, :1494+ `internalShareNote`, :1671-1715 `internalSharedList`: **sharing disabled for encrypted accounts in v1** (no owner key at read time).
- :1257-1275 `deleteMany`, :1751-1761 `insertNoteReference`: use `select:{id:true}` (avoid needless decrypt). :1766-1825 `deleteNotes` works on ciphertext, but filters `accountId: ctx.id` (breaks purge/admin delete — see bugs).

**aiServer/index.ts**: :127-198 `embeddingUpsert` (drop `text` :173; preserve encrypted `location` in :177-186 metadata read-modify-write), :200-262 `embeddingInsertAttachments` (:243 drop `text`; `getFile` → stream/temp; key check), :282-329 `embedNoteWithMetadata` (decrypt; skip+mark pending when locked), :372-457 `completions` (:446 remove `console.log` of history), :462-521 `AIComment` (writes plaintext comment), :551-800 `suggestTags`/`scoreMood` (inputs logged to `aiTaskLog.calls`), :810-888 `appendTagsIfUnchanged` and :1520-1625 `transcribeAndAppend` (CAS on raw content → `rawCas`; :1614 embeds without `accountId` — call `embedNoteWithMetadata`), :890-1159 `postProcessNote` (detached after response → capture key ref at start, abort cleanly if locked), :1161-1260 `reanalyzeNote`, :1270-1318 `transcribeAudio` (stream from `openPlainStream`; remove transcript `console.log` :1313), :1328-1457 attachment audio (no temp file; log output length not text :1418), :82-90 `hasTranscriptionBlock` callers decrypt first.
**aiServer/aiModelFactory.ts**: :107-192 `queryVector` (decrypt topK + nested reference contents), :786-822 `describeImage` accept Buffer, :194-259 `rebuildVectorIndex` global delete → per-account only.
**aiServer/tools**: `createBlinko.ts:18` remove content log; `searchBlinko.ts:56-75` inherits decrypt/locked errors; `routerExpress/mcp.ts:150-192`, `openai.ts:48` (remove body log), :91,:130 → locked ⇒ error/no-RAG.
**routerTrpc/ai.ts**: :45-68 client-supplied content (fine), :71-88 `embeddingInsertAttachments` file path unchecked, :189-213 no ownership on `conversationId`, :281-291 `AIComment` no ownership, :293-327 rebuild procs not admin-gated, :369-427 `tagAuditPendingCount` loads all users' notes → scope + select columns + flags, :278 remove log.
**routerTrpc/tag.ts**: :72-102 attach/detach, :157-160 batchUpdate, :181-186 rename, :227-260 deleteOnlyTag → decrypt→edit→re-encrypt via `rawCas`; add missing `accountId` filters (:157,:181,:227).
**routerTrpc/analytics.ts**: :90-100 `SUM(LENGTH(content))` → `plainLength`; :155-190 location aggregate → `lib/location.ts` streaming decrypt of `metadata` only (select id, createdAt, metadata).
**routerTrpc/comment.ts** (:168-230 create incl. `notifications.content` text + `commentWebhook.ts:49`, :356-378 update, list reads), **message.ts** (:9-64), **conversation.ts** (title) — if extension confirmed.
**routerTrpc/user.ts:599-604** `select id` only; delete slots on account delete. **routerTrpc/public.ts:209-330** `musicMetadata` is unauthenticated and reads any file → `authProcedure` + ownership + decrypt head only. **routerTrpc/task.ts:117-215** imports take `filePath` without ownership (IDOR), export `baseURL` is client-controlled (JWT sent to arbitrary host). **routerTrpc/attachment.ts** rename/move/delete are ciphertext-safe (`:336` S3 rename path bug).

**Files/attachments**: `routerExpress/file/upload.ts:65-197` (insert encrypt Transform before `uploadFileStream` :166; no backpressure :97-115; require unlocked else 423), `upload-by-url.ts:103-117` (buffer + SSRF; encrypt in `uploadFile`), `lib/files.ts` `uploadFile` :200-254, `uploadFileStream` :354-478 (S3 multipart :389-416 / local write :437-455 both get the Transform), `createAttachment` :482-506 (`encrypted` flag; filenames stay plaintext — leak, optionally randomize on-disk name), `getFile` :317-350 (S3 writes **plaintext temp file** web-reachable via `file.ts:98`; return stream/buffer, temp files in 0600 dir outside web root, always cleanup, startup sweep), `getFileBuffer` :289-312, rename/move/delete :261-284,:509-626 unchanged. `file.ts:89-336` serve: :148 ownership check broken (any authed user reads any file), :171-203 thumbnails (pipe decrypt→sharp, `Cache-Control: private`), :234-281 range, :283-327 full/small → all decrypt with plaintext `Content-Length`, `?token=` full JWT in URLs → scoped short-lived media token. `s3file.ts:116-230` presigned 302 redirect can't serve ciphertext → proxy `GetObject` + Range through decrypt; :20-66 thumbnails buffer whole object; :188-203 fallback redirect leaks ciphertext. Avatars/backgrounds excluded from encryption (`accounts.image`; needed pre-unlock) via `attachments.metadata.public`.

**Jobs**: `tagAuditJob.ts` :259-263,:279-284,:296-303 (loads **every** note incl. content),:319-330 → per-unlocked-account keyset loops, flag/plaintext predicates, drop `content.slice(0,30)` from progress cache (:367,:393,:411,:464,:470; also `rebuildEmbeddingJob.ts` ~:247,:251,:287-356; `dbjob.ts:363-370`). `rebuildEmbeddingJob.ts` :200-207 global `deleteIndex` wipes locked users' vectors → per-account delete only; :247/:378 use `embedNoteWithMetadata`. `dbjob.ts`: `RunTask` :44-75 (full-table one-array dump incl. `account` password hash, plaintext `bak.json` never deleted, whole `.blinko` zipped incl. vector + temp, no `metadata`/location in backup) → ciphertext NDJSON incl. slots, delete `bak.json`, exclude `vector/` + `files/temp/`; `RestoreDB` :190-380 via `upsert` would double-encrypt → raw `prisma` create keeping ciphertext + restore slots; `ExporMDFiles` :404-507 (whole library in memory, AdmZip, plaintext zip served to any authed user) → stream, 0600, owner-only, unlocked required. `memosJob.ts:79,122,216,85,105` exact-content dedupe breaks → memo-id map; :248-266 attachments without accountId. `markdownJob.ts:31-38` leaves extracted plaintext on disk. `aiScheduledTaskJob.ts:55-64,:100-125` no session → skip locked + mark `lastResult.error`; `purgeTrashJob.ts` needs no key (but see bug). `prisma/seedData.ts:207-216` `findMany()` all notes → `count`.

**Sinks to close**: `lib/aiTaskLog.ts:105-173` (full prompts/outputs, 20 000 chars each in `calls`) → log lengths/hashes for encrypted accounts; `cache` snippets; `notifications.content`; webhooks; console logs (`note.ts:836`, `createBlinko.ts:18`, `openai.ts:48`, `aiServer/index.ts:446,:1313`, `ai.ts:278`, `s3file.ts:194-205` signed URLs); LibSQL `text`; export zips; `markdown_extract_*` dirs.

**Existing bugs found (fix while touching)**: `file.ts:148` ownership; `task.ts` import path IDOR + `baseURL` token leak; `ai.ts` AIComment/`embeddingInsertAttachments`/`summarizeConversationTitle` ownership; `purgeTrashJob` + `deleteNotes` filter by admin id (other users' trash never purged, account delete deletes nothing); `tag.ts` missing `accountId`; `publicList` cache key; `embeddingDeleteAll` truncates global index.

### Suggested stages (each shippable)
1. keyring + slots + unlock UI + settings (window, warnings) + recovery flow.
2. Notes: content/location/history encryption, new plaintext columns, list/detail/upsert/search, tags CAS, analytics; sinks (logs, `aiTaskLog`, cache, webhooks).
3. AI + jobs: unlocked-only iteration, backlog-on-unlock, drop vector `text`, RAG decrypt.
4. Files: chunked encryption, serve/thumbnail/range (local + S3), upload, temp-file removal.
5. Backup/restore/export/import; sharing disabled for encrypted accounts; enable/migrate flow (resumable) and disable flow.

---

## Verification
- F1: owner tests Android Chrome + installed iOS PWA (5 min recording keeps screen on; lock released on stop/cancel/dismiss; re-acquired after tab switch; mic stops when dialog dismissed by Esc/backdrop).
- F2: create entry with location; check `metadata.location` with read-only `psql`; card chip + Info row; two nearby entries merge into one heatmap cluster, click lists both; feed cell filter; Nominatim down → coordinate label.
- SSO identity: create a Pocket-ID test user, log in, rename them in Pocket-ID, log in again → same account/entries (via `sub`), name updated; pre-existing account (no `sub` yet) gets `sub` backfilled on first login.
- F3 (on a throwaway SSO account first; never `prisma migrate dev/reset` — real remote DB): `psql` shows content/location/history and files as ciphertext; scratch script (`cd server && bun --env-file ../.env ...`) cannot read without key; locked state blocks reads/AI/MCP/nightly jobs and backlog resumes on unlock; kill process mid-migration and mid-slot-change (old slot still unlocks); forgot-passphrase paths (recovery key, other slot, still-unlocked device); range request + thumbnail on encrypted audio/image, local and S3; search on ~10k synthetic notes stays within memory cap; restore a backup with fresh unlock; grep DB/logs/vector store/cache/`aiTaskLog` for a canary string.
