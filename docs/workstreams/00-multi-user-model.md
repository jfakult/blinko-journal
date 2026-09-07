# Workstream 0 — Multi-user / Family Sharing Model

Resolved by reading the actual schema and query logic in this repo (no throwaway instance needed — see `docs/PROJECT_BRIEF.md` §Research findings for why).

## How note visibility actually works today

- `prisma/schema.prisma`: every note has a single-owner `accountId`. There is **no shared/pooled feed** — by default a note is visible only to its owner.
- Two distinct sharing mechanisms exist, and it's easy to confuse them:
  - **`follows` model + `followsRouter` (`server/routerTrpc/follows.ts`)** — this is **cross-site federation**, not in-app sharing. `follow()` takes a `siteUrl`, calls that *other server's* `/api/v1/public/site-info` and `/api/v1/follows/follow-from` endpoints over HTTP. It's for subscribing to another public Blinko *instance's* public notes (RSS/ActivityPub-style), not for two accounts on the same instance seeing each other's entries. **Not useful for a same-instance family feed.**
  - **`noteInternalShare` model** (`accountId`, `canEdit`) — this *is* the real in-app, same-instance sharing primitive. Confirmed in `server/routerTrpc/note.ts`'s list query (around line 122): a note shows up in a user's list if `accountId = them` **or** `internalShares: { some: { accountId: them } }`. So explicitly internal-sharing a note with another account makes it appear in that account's normal note feed, with `canEdit` controlling write access.

## Recommendation

Model "family journal" as: **one SSO (Pocket-ID) account per family member**, with entries internally shared to the rest of the family via `noteInternalShare` — not the single-shared-account approach (which would collapse per-person SSO identity and per-person voice/tagging attribution) and not `follows` (wrong mechanism, designed for cross-server subscriptions).

Two ways to get every new entry auto-shared with the rest of the family, in order of preference:
1. **Default share-list on note creation** — check whether the note-creation tRPC procedure (`note.upsert` in `note.ts`) accepts a share list at creation time; if so, the voice-capture plugin (Workstream 3) can pass the family's account IDs automatically so every entry is shared the moment it's created, no user action required.
2. If note creation doesn't support that, a lightweight background job (or a small, `// CUSTOM-JOURNAL:`-marked hook in the note-creation path) that internally-shares every new note with the configured family account list.

This affects:
- **Workstream 3** (voice capture): the "record" action should create the note already shared with the family accounts per the recommendation above.
- **Workstream 5 / 6** (reskin/declutter): the UI should surface "the family feed" as effectively the default view (own notes + shared-with-me notes), and hide/de-emphasize the follow/federation UI (`BlinkoFollowDialog`) entirely — it solves a different problem than what this journal needs and would confuse non-technical users.

## Also relevant to Workstream 4 (location logging)

`notes` has no dedicated location column — location is stored in the generic `metadata Json?` field on each note. Whatever writes location data (likely frontend geolocation capture) puts it there; Workstream 4 should confirm the exact metadata shape by finding where the frontend populates it, and the analytics view (Workstream 8) should read location out of `metadata`, not a schema field.

## Also relevant to Workstream 8 (analytics)

Blinko already ships a `BlinkoAnalytics` component (`app/src/components/BlinkoAnalytics/`: `HeatMap.tsx`, `StatsCards.tsx`, `TagDistributionChart.tsx`) backed by an `analytics.ts` tRPC router. Workstream 8 should extend/reuse this existing view rather than building a new one from scratch inside a plugin dialog — check first whether it already covers "locations, moods, trends" before assuming a full rebuild is needed.
