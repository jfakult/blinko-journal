# Workstream 0 — Multi-user / Family Sharing Model

**Resolution: not needed.** The original brief's framing ("a journal for a small group of family and friends," with account-sharing as a requirement) was included by accident — confirmed with the user. This is a **single-user personal journal**: one person, one Pocket-ID login. There is no second account, no pooled feed, and no sharing to design.

Practical effect on the other workstreams:
- **No account-sharing work of any kind.** Don't build on `noteInternalShare`, don't provision multiple accounts, don't add a "share with family" step to note creation.
- **Workstream 3** (voice capture): the recorded entry just needs to land in the single account's normal note list — no share-list, no `internalShares` call.
- **Workstream 5 / 6** (reskin/declutter): still hide the cross-site `follows`/`BlinkoFollowDialog` feature — it's irrelevant to a single-user journal regardless of the family-sharing question, since it's for following *other people's public Blinko instances*, not a same-instance concept at all.
- **Workstream 8** (analytics): analytics should just be scoped to the one account's own notes — no cross-account aggregation needed, which was already how the native `analytics.ts` router queries by `ctx.id` (the logged-in account), so no changes needed on that front either.

## What's still true from the earlier read of the code (kept for reference)

The research into how sharing works in Blinko (`noteInternalShare` = same-instance sharing with `canEdit`; `follows` = cross-site federation, unrelated) turned out not to matter for this project, but is accurate and left here in case a future "add a second person" request ever comes back — at that point, re-read this history rather than re-deriving it from scratch.

Also still relevant regardless of the sharing question:
- `notes` has no dedicated `location` column — location lives in the generic `metadata Json?` field on each note (Workstream 4/8 should confirm the exact shape from where the frontend writes it).
- Blinko already ships a native analytics view (`app/src/components/BlinkoAnalytics/`: `HeatMap.tsx`, `StatsCards.tsx`, `TagDistributionChart.tsx`, backed by `server/routerTrpc/analytics.ts`) — Workstream 8 should extend this rather than building a new dashboard from scratch.
