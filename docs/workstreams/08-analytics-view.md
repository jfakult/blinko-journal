# Workstream 8 — Analytics View

> **Update — see `docs/workstreams/10-tags-and-mood.md`.** Two things below
> are now stale: (1) `TagDistributionChart.tsx` is now clickable — a slice
> click shows a count + a "View entries" button that navigates to the
> filtered note list, via a new `tagId` field on `tagStats`. (2) The
> "Moods — covered *transitively*" section below no longer reflects current
> state: a first-class, structured, AI-scored mood system now exists
> (`moodAxis` model + `notes.moodScores`, valence + 8 basic emotions,
> 0-100 each) alongside the tag-based mood signal this section describes —
> it isn't purely tag-derived anymore. A dedicated mood chart on this page
> is still genuinely not built (see workstream 10's "Not done" list) — the
> data now exists to build one, it just hasn't been added to `analytics.ts`/
> this page yet.

**Branch:** `feature/analytics-view`. **Priority:** lowest in the brief — sequenced to finish last, done thoroughly anyway per instructions.

## Correction to the brief

The brief (`docs/PROJECT_BRIEF.md` §2, §6 Workstream 8) assumes Blinko has **no native
analytics dashboard**, only AI-generated "Daily Review" summary text. That's wrong. This
fork already ships a real, chart-based analytics view:

- `server/routerTrpc/analytics.ts` — a tRPC router (`dailyNoteCount`, `monthlyStats`)
- `app/src/components/BlinkoAnalytics/HeatMap.tsx` — a GitHub-style yearly activity heat map (echarts `calendar` + `heatmap`)
- `app/src/components/BlinkoAnalytics/StatsCards.tsx` — note count / total words / max daily words / active days, for the selected month
- `app/src/components/BlinkoAnalytics/TagDistributionChart.tsx` — a pie chart of tag frequency for the selected month
- `app/src/pages/analytics.tsx` — the page that composes all three, with a month picker
- `app/src/store/analyticsStore.ts` — the MobX store (`PromiseState`-wrapped tRPC calls)

So this workstream's real job (per updated instructions) was to determine how much of
requirement 9 — *"high-level analysis over time: locations, moods, trends"* — this
already covers, and close any genuine gap by extending the native view rather than
building something new.

## What's already covered natively

**Trends over time — fully covered.**
- `HeatMap.tsx` (via `analytics.dailyNoteCount`, `server/routerTrpc/analytics.ts:9-32`) plots
  daily note volume across the last year — a direct visual "trend" over time.
- `StatsCards.tsx` + the month picker in `analytics.tsx:38-71` give month-over-month
  comparison of note count, word count, and active days.
- `TagDistributionChart.tsx` (via `analytics.monthlyStats`'s `tagStats`,
  `server/routerTrpc/analytics.ts:88-132` pre-change) shows tag frequency for the
  selected month, and the month picker makes tag-trend-over-time achievable by
  flipping months. No changes needed here.

**Moods — covered *transitively*, not as a first-class concept, and only once
Workstream 4 lands.**
- There is no dedicated "mood" field or convention anywhere in this codebase. Checked:
  `grep -rn "mood" app/src server shared` (case-insensitive) returns nothing outside
  `docs/PROJECT_BRIEF.md` itself.
- Blinko's mood handling, per this fork's design, is meant to happen entirely through
  the existing tag system: Workstream 4's brief item is "tune the auto-tagging prompt
  so tags are journal-appropriate (people, places, **moods**, occasions)"
  (`docs/PROJECT_BRIEF.md:103`, Workstream 4, branch `config/ai-pipeline`). I checked
  that branch's state (`git log origin/config/ai-pipeline`, `git diff main
  origin/config/ai-pipeline --stat`) — it has not started that work yet (only carries
  the WS0 doc-scope-correction commits also present on `main`).
- Practical conclusion: once WS4 tunes the tagging prompt to emit mood-ish tags (e.g.
  "grateful," "tired," "anxious"), those tags flow into `tagsToNote` like any other tag
  and **will automatically appear** in the existing `TagDistributionChart` — no analytics
  code changes are needed for moods specifically. I did not add a separate
  mood-only chart because (a) there's no structured signal to distinguish a "mood" tag
  from any other tag today, and (b) inventing one now would just be a naming convention
  with nothing behind it until WS4 defines the actual tagging prompt. If WS4 lands and
  a clean mood/non-mood tag distinction turns out to be wanted, the cleanest follow-up
  is a tag-name-prefix convention (e.g. `mood:grateful`) filtered client-side into a
  second pie chart reusing `TagDistributionChart`'s pattern — flagged here for whoever
  picks up WS4 or revisits this later.

## What was missing: location-based aggregation

Confirmed genuinely absent, and non-trivial (unlike moods, this can't ride on an
existing mechanism):

- `analytics.ts` and all three chart components were purely tag/time-based — zero
  references to `notes.metadata` anywhere in the analytics code path (verified by
  reading every line of all four files before this change).
- More fundamentally: **Blinko has no location-*capture* feature in this codebase at
  all**, despite the brief's §2 claim of "Native location tagging." Checked
  exhaustively:
  - `grep -rn "location\|geo\|lat\|lng\|latitude\|longitude" app/src/components/BlinkoEditor/index.tsx` — the only hit is React Router's `useLocation()`, unrelated.
  - No `navigator.geolocation` / `Geolocation` usage anywhere in `app/src`, `server`, `shared`, `app/src-tauri`, or `app/tauri-plugin-blinko`.
  - `notes.metadata` (`prisma/schema.prisma:56` — generic `Json?`) is currently written
    in exactly two places, neither of which is location:
    `expireAt` (note self-destruct, see `app/src/components/BlinkoRightClickMenu/index.tsx:44-50`,
    `app/src/components/BlinkoCard/cardFooter.tsx:55-105`) and `isIndexed` /
    voice-recording metadata (`app/src/components/Common/Editor/editorStore.tsx:60,381,395`).
  - This confirms `docs/workstreams/00-multi-user-model.md`'s note (line 16): *"`notes`
    has no dedicated `location` column — location lives in the generic `metadata Json?`
    field... Workstream 4/8 should confirm the exact shape from where the frontend
    writes it"* — the exact shape doesn't exist yet because nothing writes it yet. That
    capture flow is implicitly Workstream 4's territory (`config/ai-pipeline`,
    "Test location logging end-to-end from a mobile device," `docs/PROJECT_BRIEF.md:106`),
    not this one, and per the branch check above it hasn't been built.

### Decision: extend the native view now, as forward-compatible plumbing

Rather than wait idle for WS4 (workstreams are meant to be startable in parallel, and
this one is explicitly "can start anytime but should finish last"), I extended
`analytics.ts` / `BlinkoAnalytics` to aggregate location data **once it exists**, using
the same top-N-plus-"Others" pattern already established by `tagStats`. Until a capture
flow writes to `metadata.location`, the new query returns an empty array and the new
chart simply doesn't render (same pattern the tag chart already uses:
`stats?.tagStats && stats.tagStats.length > 0`) — no broken or empty-looking UI in the
interim.

**Established metadata contract** (documented here so Workstream 4's location-capture
work has a concrete target to write to):

```json
{
  "location": {
    "name": "Golden Gate Park",
    "lat": 37.7694,
    "lng": -122.4862
  }
}
```

`name` is the field analytics groups on. Raw `lat`/`lng` pairs are stored for
potential future use (e.g. a map view) but are not aggregated here — GPS coordinates
are essentially never bit-for-bit identical across separate visits, so grouping on
them would produce one bucket per note instead of a meaningful distribution. Grouping
needs a human-readable place label, which means Workstream 4's capture flow should
reverse-geocode (or let the user name) the location before writing `metadata.location.name`,
not just store raw coordinates.

### Why extend the core router/components, not a plugin

Per the updated brief guidance for this workstream: the plugin-preference in
`docs/PROJECT_BRIEF.md` §3 is about avoiding new UI surfaces where a plugin dialog
would do, and about not needing a documented custom-route plugin hook (there isn't
one — the plugin API in §4 is toolbar icons, right-click menu items, and CSS; no
route/page registration). Deepening an *existing first-party* analytics view via its
own router/components is:
- More maintainable — one query, one chart, following the exact existing pattern,
  vs. a second, parallel plugin-based data-fetching/rendering path for the same
  concept.
- Actually simpler here — `window.Blinko.api` plugin access is the *same* tRPC
  client already used by `analyticsStore.ts`; there's no capability a plugin would
  gain, only a `showDialog` overlay that would sit awkwardly next to (not inside) the
  existing analytics page.
- Correctly scoped and marked — every core-file change is tagged `// CUSTOM-JOURNAL:`
  per the brief's merge-hygiene rule, and is additive (new procedure fields, a new
  component file) rather than a modification of existing tag/time logic, so an
  upstream merge conflict here should be small and obvious.

No `plugins/analytics-extras/` was built — there was no concrete reason extending the
native view wasn't feasible; quite the opposite, it was the more maintainable path.

## Files touched

- `server/routerTrpc/analytics.ts` — added `locationStats` to `monthlyStats`'s output
  and a `$queryRaw` aggregation over `metadata->'location'->>'name'`, mirroring the
  existing `tagStats` top-10-plus-Others logic. All additions marked `// CUSTOM-JOURNAL:`.
- `app/src/components/BlinkoAnalytics/LocationDistributionChart.tsx` — new file, a
  straight structural port of `TagDistributionChart.tsx` (same echarts pie-chart
  config, theming, legend/resize behavior) pointed at `locationStats` instead of
  `tagStats`.
- `app/src/store/analyticsStore.ts` — added `locationStats?` to the `MonthlyStats`
  interface.
- `app/src/pages/analytics.tsx` — imports and conditionally renders
  `LocationDistributionChart`, gated on `stats?.locationStats?.length > 0` (same
  pattern as the existing tag chart gate).
- `app/public/locales/en/translation.json` — added `location-distribution` and
  `other-locations` keys (English only; the repo has ~17 other locale files but no
  existing convention here for auto-translating new keys — other languages will fall
  back to the key/English string via i18next until someone translates them, same as
  any other newly-added key in this codebase).

## Not done here (out of scope / blocked on other workstreams)

- No location-*capture* code (geolocation permission prompt, reverse geocoding,
  writing `metadata.location`) — that's Workstream 4's territory per the brief, and
  it hasn't started on `config/ai-pipeline` as of this writing. This workstream only
  builds the read side so it lights up automatically once WS4 writes that field.
- No dedicated mood chart/tag-prefix convention — see "Moods" section above; nothing
  to key off yet, revisit once WS4's tagging prompt is defined.
- No changes to `dailyNoteCount`/`HeatMap` — trend-over-time was already fully covered.
