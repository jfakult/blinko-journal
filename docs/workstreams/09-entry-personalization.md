# Workstream 9 — Entry Personalization (Research)

Status: **research only** — no code changed. This doc is written so a future
implementation session can start directly from it without re-reading the
source tree. All file paths and code excerpts below were read from the repo
on 2026-09-08, not guessed.

Scope of "the entry page": `app/src/components/BlinkoEditor/index.tsx` (the
compose surface), `app/src/components/BlinkoCard/` (the card + its expanded
"blog" reading view via `FullscreenEditor.tsx`), and `app/src/pages/detail/`
(the permalink page, which is just `BlinkoCard` in non-collapsed form). These
three are the same visual system — a personalization mechanism built once in
the card/editor layer applies to all three automatically.

## 1. What the codebase already gives us (read first, matters a lot)

Four existing mechanisms change the calculus for every idea below:

**1a. A dormant per-entry `metadata: any` field already flows end-to-end.**
`EditorStore` (`app/src/components/Common/Editor/editorStore.tsx:60`) has a
`metadata: any = {}` field that is currently set nowhere and read nowhere
except passed straight through on send:

```ts
// editorStore.tsx:368-389 handleSend()
await this.onSend?.({
  content: ...,
  files: ...,
  noteType: this.noteType,
  references: this.references,
  metadata: this.metadata   // <-- already wired, unused today
});
```

`BlinkoEditor/index.tsx`'s `onSend` callback (lines 150, 168-177) forwards
`metadata` straight into `blinko.upsertNote.call({ ..., metadata })` for both
create and edit. Server-side, `server/routerTrpc/note.ts` (`upsert`, around
line 946-959) merges it into the `notes.metadata` `Json?` Prisma column:

```ts
if (input.metadata && id) {
  const existingNote = await prisma.notes.findUnique({ where: { id, accountId: ... }, select: { metadata: true } });
  update.metadata = { ...(existingNote?.metadata || {}), ...input.metadata }; // shallow merge, additive
} else if (input.metadata) {
  update.metadata = input.metadata;
}
```

This means: **per-entry customization storage is not something to build — it
already exists, is already namespaced-additive (shallow merge, so a new key
like `metadata.personalization` won't clobber `metadata.expireAt` or
`metadata.isIndexed`, the two keys currently in use — see
`app/src/components/BlinkoCard/cardFooter.tsx:55,90,101,145,178`), and already
round-trips from editor → API → DB → card render** (`note.ts:744` selects
`metadata` back out on read). Any per-entry idea (background, cover image,
font override) should store its choice under a new `metadata.<namespace>` key
and read it back in `BlinkoCard`/`BlinkoEditor`. This is a small, additive,
low-risk core-file change (new key usage, not new plumbing).

**1b. There is already a global-only "custom background" feature — and it's
not what it sounds like.** The `customBackgroundUrl` config key (surfaced in
`server/routerTrpc/config.ts:26`, editable in
`app/src/components/BlinkoSettings/PerferSetting.tsx:456-463`) does not hold
an image. It's consumed by `app/src/components/Common/GradientBackground.tsx`,
which feeds it as a **ShaderGradient query-string config** (`@shadergradient/react`,
a 3D WebGL animated gradient library) — `customBackgroundUrl` is literally a
serialized set of shader parameters (colors, rotation, camera angle, etc.),
not a path to an uploaded file. Two important facts:
- `GradientBackground` is only mounted on `signin.tsx`, `signup.tsx`,
  `hub.tsx`, and `share/[id].tsx` — **it is never used on the entry
  page, card, or detail view today.** It's an auth-screen/marketing-page
  background, unrelated to journaling surfaces.
- It's global and DB-driven (one value for the whole instance), not per-entry.
- Reusing it for "custom backgrounds on the entry page" would mean either (a)
  mounting `GradientBackground` around the editor too (cheap, but it's an
  animated 3D shader, tonally wrong for "warm paper journal" — it reads as
  SaaS-marketing-page, not journal) or (b) building something new. Building
  something new is the right call — see §3.1.

**1c. The font system already has a `handwriting` category and per-note
plumbing is close but not there.** `prisma/defaultFonts.ts` defines
`category: z.enum(['serif', 'sans-serif', 'monospace', 'display', 'handwriting'])`
and `server/routerTrpc/font.ts` has full CRUD + a `list`/`get` API already
serving fonts (CDN-based via `url`, or self-hosted via base64 `fileData`).
Today, though, font selection is **global-only**: `fontStyle` is a `Config`
key (`server/routerTrpc/config.ts`), set via `FontSwitcher` in
`PerferSetting.tsx:350-353`, and applied by
`app/src/store/user.ts:313-315` (`initializeFonts(config.fontStyle)`) which
sets `--font-family` on `:root` — one font for the whole app, same
inline-style-beats-CSS-file mechanism documented in workstream 05 for
`--primary`. There is no per-note font field today. Given `metadata` already
round-trips (§1a), adding one is a small lift, not a new subsystem.

**1d. No sound infrastructure exists yet — but the pattern to follow does.**
Grepped the whole app for `new Audio(`, `.play(`, Howler, notification sounds:
only two hits, both non-UI-sound: `editorStore.tsx:180` uses `new Audio()`
purely to read a voice memo's *duration* metadata (`loadedmetadata` event,
never calls `.play()`), and `musicManagerStore.tsx` (`.play()` at lines 253,
283) is Blinko's built-in **music player feature** (plays user-uploaded music
files as background audio while browsing — unrelated to journaling, and
likely a candidate for the `journal-declutter` plugin to hide per
`docs/workstreams/06-ui-declutter.md`'s stated scope, not a pattern to
extend). `BlinkoNotification/index.tsx` is a toast/bell dropdown — no sound.
**Conclusion: chimes/tones would be built from scratch**, but that's a small
lift (`new Audio('/sounds/x.mp3').play()`, one `<audio>` tag or a tiny
`SoundManager` singleton) — there's no complex existing system fighting you,
just nothing to reuse either.

**1e. The upload pipeline is a single, reusable, already-authenticated path.**
`server/routerExpress/file/upload.ts` (`POST /api/file/upload`, multipart via
`busboy`) is the one file-upload endpoint in the app, already used by both
attachments and voice memos. Client-side,
`editorStore.tsx:202-297` (`uploadFiles`) is the calling pattern: build a
`FormData`, `axiosInstance.post(getBlinkoEndpoint('/api/file/upload'), formData, { onUploadProgress })`,
then get back `{ filePath, fileName, type }` and store `filePath`. **A "cover
image" or "background image" upload UI would call this exact same endpoint**
— no new upload route needed, just a new call site (e.g. a dropzone in a new
toolbar button) that stores the resulting path in `metadata` instead of
pushing to the attachments array.

**1f. Recording start/stop is a clean, single hook point.** The actual
`MediaRecorder` logic lives in `app/src/components/Common/AudioRecorder/hook.ts`
(`startRecording`/`stopRecording`), consumed by
`app/src/components/Common/AudioDialog/index.tsx` (`MyAudioRecorder`), which
is what the voice-record button (and workstream 3's always-visible record
button, `app/src/components/BlinkoAddButton/index.tsx`) opens. This is the
one place a "start chime" / "ambient sound while recording" hook belongs —
wrap `startRecording`/`stopRecording` calls in `AudioDialog/index.tsx`, don't
chase the record button itself (there are at least two entry points to it:
the toolbar `UploadButtons` `hugeicons:voice-id` icon and the landing-screen
button from workstream 3 — both funnel into this one dialog).

**1g. "Finish" is a single choke point too.** `EditorStore.handleSend()`
(`editorStore.tsx:368`) is called by every send path (toolbar `SendButton`,
Enter-to-send keyboard shortcut, etc. — checked: `SendButton/index.tsx` just
calls `store.handleSend()`, nothing else duplicates the send logic). A
"finish" chime/animation belongs inside `handleSend()`, not in `SendButton`,
so it fires regardless of how send was triggered.

**1h. AI auto-tagging already produces mood tags — don't rebuild this.**
`prisma/seed.ts:229-234` shows the scheduled AI tagging prompt already
extracts `#mood/grateful`, `#mood/anxious`, etc. as part of its standard tag
taxonomy (alongside `#people/`, `#places/`, `#occasion/`). There is no
"today's mood" picker UI and no dedicated mood field — mood already surfaces
as a tag. A personalization feature that wants mood-awareness (e.g.
mood-tinted card accents) should **read the existing `#mood/*` tag**, not
invent a parallel mood-selection UI that would compete with the AI tagging
the project already leans on.

**1i. A per-entry cover-gradient concept already exists in the code, unused.**
`app/src/components/BlinkoCard/cardBlogBox.tsx:17-28` defines a
`gradientPairs: [string, string][]` array of ten color pairs — but nothing in
the file (or anywhere else, grepped) reads it. It's dead code, presumably a
remnant of a deterministic "pick a gradient by note id" cover-image fallback
from upstream Blinko's blog-card feature. It's a ready-made building block
(hash note id → index → gradient) for a "cover image, but no image uploaded"
default state, described in §3.3.

## 2. Plugin vs. core-file assessment method

Per `docs/PROJECT_BRIEF.md` §3/4: plugins are additive-only (toolbar icons,
context-menu items, card-footer slots, CSS injection via
`window.Blinko.addToolBarIcon` / `addCardFooterSlot` / shipped `.css` files)
and CSS files are auto-loaded from any plugin's installed directory (see
`plugins/journal-declutter/` for the working pattern: a `plugin.json`
manifest + a `src/index.tsx` that's mostly a no-op class + a `src/style.css`
that does the real work). Workstream 3's finding (`docs/workstreams/03-voice-capture.md`
§2) already established the boundary concretely: additive hooks render
*inside* an open note/card/menu, never restructure app chrome or touch the
data model. Applying that same test to each idea below:

- **Pure global CSS/theme** (color/pattern only, no new data): plugin-clean.
- **Anything that needs to persist a *choice* (which image, which font) *per
  entry***: needs `metadata` read/write, which means touching
  `BlinkoEditor/index.tsx` and/or `BlinkoCard/` — core files, but a small,
  additive, `// CUSTOM-JOURNAL:`-tagged diff each time, consistent with how
  workstream 5 and 3 already justified their core touches.
  `addCardFooterSlot` plugin hooks cannot reach *how the card container
  itself is styled* (background, border) — only add content inside it — so a
  per-entry background specifically cannot be done as a plugin no matter how
  small, because the plugin API has no "set a style on the card root" hook.
- **New upload UI / new sound files**: static assets, no core-file risk
  either way; only the *wiring* (where the upload button lives, where the
  audio call fires) determines plugin-vs-core, per the tests above.

## 3. Idea-by-idea assessment

### 3.1 Starter idea: Custom backgrounds (patterns / colors / uploaded image)

**Verdict: good fit for patterns/colors (do this), weak fit for full uploaded
photo backgrounds behind entry text (recommend against, or scope it down).**

Reasoning against full photo backgrounds: this app's whole visual identity
(workstream 05) is "warm paper and ink" — cream backgrounds, warm-brown ink
text, high legibility, minimal chrome. A user-uploaded photo *behind
scrollable markdown text* creates a legibility problem (need a scrim/overlay,
contrast-checking against arbitrary images, dark-mode contrast doubling the
problem) that a single-user personal app doesn't need to solve just to look
"personal" — it's the kind of feature that looks great in a screenshot and
gets turned off within a week because it makes re-reading old entries harder.
Day One and Journey (real journaling apps) both learned this the same way:
their "cover photo" treatments live in the *card/list thumbnail* and
*share-image export*, never as text-underlay in the writing view.

**What to build instead — a small palette of warm paper *textures/patterns*,
picked per entry, applied as the card/editor container background:**
- Small, curated set (5-8) of subtle CSS `background-image` patterns (paper
  grain, linen weave, dot-grid, blank) as tileable SVG/PNG data-URIs or small
  static assets — same visual language as `globals.css`'s existing warm
  palette (`--secondbackground: #f3e9d8` etc.), just textured instead of flat.
  This is genuinely closer to what a physical journal offers (different paper
  stocks) than a photo background would be.
- Store the chosen pattern key in `metadata.personalization.background` (per
  §1a's pattern), read it in `BlinkoEditor/index.tsx` and `BlinkoCard/index.tsx`
  to set a CSS class/custom property on the card/editor root.
- A **solid warm-accent color picker** (reusing the existing `--primary`
  color-picker UI pattern from `ThemeColor.tsx`, just scoped to
  `metadata` instead of global `Config`) is an even smaller version of the
  same idea and could ship first.
- Skip user-uploaded *background* images entirely; if the user wants their
  own photos on an entry, that's `§3.3`'s cover-image idea instead
  (photo *with* the entry, not *behind* the text).

**Scope:** medium (pattern asset creation + a small picker UI + metadata
read/write in editor and card). **Plugin vs core:** core-file, small — the
picker is a new small component (follow `ThemeColor.tsx`'s structure) invoked
from a new toolbar button (follow `Toolbar/UploadButtons/index.tsx`'s
structure for "how to add an icon+popover to the editor toolbar"), and two
read sites (`BlinkoEditor/index.tsx`, `BlinkoCard/index.tsx`) need a
`style`/`className` computed from `blinkoItem.metadata?.personalization?.background`.
**Starting points:**
- `app/src/components/Common/Editor/Toolbar/UploadButtons/index.tsx` — pattern for a new toolbar icon+popover.
- `app/src/components/Common/Theme/ThemeColor.tsx` — pattern for a color-picker UI (adapt to write to `EditorStore.metadata` instead of global config).
- `app/src/components/Common/Editor/editorStore.tsx:60` — set `this.metadata.personalization = {...}` here.
- `app/src/components/BlinkoCard/index.tsx:119-129` (the `<Card className=...>`) — apply the stored pattern/color here for the read view.
- `app/src/styles/globals.css` — add the pattern assets/CSS classes here, following the existing `--secondbackground`/`--background` warm palette so patterns stay in-theme automatically in both light and dark mode.

### 3.2 Starter idea: Sounds (start/finish chimes)

**Verdict: good fit, small scope, do this. Recommend going one step further
than "chime at start/finish" — see 3.2b.**

A soft tone on send (writing "closes" the entry, like a book closing) is a
cheap, high-signal "this feels considered" touch that costs almost nothing
to build, per §1d/1f/1g findings: there's no competing sound system, and both
hook points (`AudioDialog`'s recording start/stop, `EditorStore.handleSend()`)
are single choke points already.

- **Start-of-entry tone**: fire once when the record dialog opens
  (`AudioDialog/index.tsx`, wrap the existing `startRecording()` call) —
  *not* on every keystroke/focus of the text editor, which would be
  annoying, not personal. If the user wants a tone for text-only entries too
  (no voice), fire it once on `BlinkoEditor` mount in create mode (`useEffect`
  at `BlinkoEditor/index.tsx:94`, gated so it only fires the first time the
  editor becomes non-empty/focused, not on every re-render).
- **Finish tone**: inside `EditorStore.handleSend()` (`editorStore.tsx:368`),
  right before or after `this.onSend?.(...)`.
- Respect a mute toggle — add a `soundEnabled` user preference (follow the
  existing boolean-preference pattern in `PerferSetting.tsx`, e.g.
  `isCloseBackgroundAnimation`'s toggle, as the template) so this doesn't
  become an unwanted surprise on a shared/loud environment.
- Implementation: a couple of short (under 1s) `.mp3`/`.ogg` files as static
  assets (`app/public/sounds/`), a tiny `SoundManager` helper
  (`new Audio(path); audio.volume = 0.4; audio.play().catch(()=>{})` — wrap in
  try/catch, browsers block autoplay without user gesture but both hook
  points here are already inside a user gesture handler, so this should be
  fine).

**3.2b — better than static chimes: pick sounds that reflect the actual
action**, since "generic notification chime" is what makes an app feel like
"a productivity tool ding," the opposite of the goal. A soft pencil/pen-nib
scratch or a page-turn sound on finish reads as "journal," where a generic
UI-toolkit "success chime" reads as "SaaS app." Cheap to source (freesound.org,
CC0), same implementation cost as a generic tone.

**Scope:** small. **Plugin vs core:** core-file, minimal and isolated (two
hook points, tag both `// CUSTOM-JOURNAL:`) — sound files themselves are just
static assets, no core logic risk.
**Starting points:**
- `app/src/components/Common/AudioDialog/index.tsx` — wrap `startRecording`/`stopRecording`.
- `app/src/components/Common/Editor/editorStore.tsx:368` (`handleSend`) — finish tone.
- `app/src/components/BlinkoSettings/PerferSetting.tsx` — add the mute toggle here, next to `isCloseBackgroundAnimation`.
- New: `app/public/sounds/*.mp3`, a small `app/src/lib/sound.ts` singleton.

### 3.3 New idea: Per-entry cover image (not a background — a small hero image with the entry)

**Verdict: strong fit — arguably better than either starter idea for "feels
personal," and reuses more existing plumbing than the background idea does.**

Day One, Journey, and Diarium all lean on this pattern: one photo attached
*to* an entry, shown as a thumbnail in the list/feed and as a header image
above the text in the detail view — never as a translucent backdrop behind
the text. It solves the same "make each entry visually distinct/personal"
goal as a background image, without the legibility problem in §3.1, and it's
closer to how the user already thinks about entries (voice-first + photos —
requirement 7 in `docs/PROJECT_BRIEF.md` §1 is "image uploads per entry",
already native — this is a small enhancement of an existing capability
distinguishing "the" cover photo from "an" attachment, not a new capability).

- Reuse the exact upload path from §1e (`POST /api/file/upload`, same
  `uploadFiles`-style call). The only new piece is: (a) a UI affordance to
  mark one uploaded image as "cover" instead of an inline attachment, and (b)
  storing that choice — `metadata.personalization.coverImagePath` — instead
  of (or in addition to) pushing it into the regular `attachments` array.
- Render it in `BlinkoCard/index.tsx` above `CardHeader` when present, sized
  consistently (e.g. 16:9 crop, `object-fit: cover`) — same spot
  `CardBlogBox.tsx` already reserves conceptually for its dead
  `gradientPairs` cover-gradient fallback (§1i). **Reuse that fallback**: if
  no cover image is set, hash the note id into `gradientPairs` for a
  deterministic (not random-per-render) colored header strip instead of
  nothing — free visual variety across entries with zero new asset work,
  and the array is already sitting there unused.
- `FullscreenEditor.tsx` (the expanded reading view) is the other render
  site — same treatment, larger.

**Scope:** medium (upload UI is the biggest piece; storage and rendering are
small given existing plumbing). **Plugin vs core:** core-file — touches the
note data model (`metadata`) and card layout, same as §3.1's reasoning.
**Starting points:**
- `app/src/components/Common/Editor/Toolbar/UploadButtons/index.tsx` — add a "set as cover" option/variant of the existing upload flow.
- `app/src/components/Common/Editor/editorStore.tsx:202-297` (`uploadFiles`) — the upload call to reuse; store result path into `this.metadata.personalization.coverImagePath` instead of `this.files` when "cover" mode is active.
- `app/src/components/BlinkoCard/cardBlogBox.tsx:17-28` — revive `gradientPairs` as the no-cover-image fallback.
- `app/src/components/BlinkoCard/index.tsx` and `FullscreenEditor.tsx` — render sites.

### 3.4 New idea: Warm serif/handwriting font, selectable per entry (not just global)

**Verdict: good, low-effort fit — the highest "personal feel per engineering
hour" ratio of anything researched, because ~90% of the plumbing already
exists.**

A journal that lets you write in a warm serif or script face (vs. the
current global `Inter` sans-serif everywhere) is a strong, well-established
"this feels like a journal, not a tool" signal — it's the single biggest
visual differentiator physical journals and apps like Journey lean on, more
than color. The `handwriting` font category already exists in the schema
(`prisma/defaultFonts.ts`) and the whole font CRUD/list API already exists
(`server/routerTrpc/font.ts`) — this is "expose what's already built" more
than "build something new."

- Ship 2-4 curated fonts in the `handwriting`/`serif` categories via
  `defaultFonts.ts`'s existing seed mechanism (check current seed list first —
  if none are seeded yet in those categories, add CDN entries, e.g. a Google
  Fonts-hosted serif/script face, following the existing `cdnFonts` entries'
  shape in `prisma/defaultFonts.ts`).
- The **global** picker already works end-to-end
  (`FontSwitcher` in `PerferSetting.tsx:350`) — if a global warm-serif default
  is enough, this is a **config-only** change (seed data + maybe changing the
  default `fontStyle` value), no code at all.
- For **per-entry** font choice specifically (matching the "entry page"
  framing of the ask): store `metadata.personalization.fontId` and apply a
  scoped `font-family` override (inline style or a data-attribute + CSS
  variable on the card/editor root, same mechanism as `--font-family` in
  `globals.css:170` but scoped instead of `:root`-global) in
  `BlinkoCard/index.tsx` and `BlinkoEditor/index.tsx`.

**Scope:** small (global-only) to medium (true per-entry). **Plugin vs core:**
config-only if global; core-file (small) if per-entry, same `metadata`
pattern as above. **Starting points:**
- `prisma/defaultFonts.ts` — add/verify warm serif+handwriting entries.
- `app/src/components/BlinkoSettings/PerferSetting.tsx:350` (`FontSwitcher`) — reference implementation for a picker; adapt for a per-entry variant reading/writing `metadata`.
- `app/src/store/user.ts:313-315` (`initializeFonts`) — reference for how a font gets turned into a usable `font-family` value; the per-entry version needs the same lookup but applied narrower than `:root`.

### 3.5 New idea: "On this day" / time-distance callback

**Verdict: good fit, very cheap, high emotional payoff — recommend including
in the shortlist even though it wasn't a starter idea.**

This is the single feature real journaling apps (Day One's "On This Day," Journey's "Memories") most consistently cite as their most-loved feature — surfacing an old entry from exactly N years ago when opening today's. It requires no new UI real estate on the entry page itself (a small dismissible card above the editor, "1 year ago today, you wrote..." with a snippet) and is a pure read query against data that already exists — no data model change, no metadata needed, nothing to migrate.

**Scope:** small. **Plugin vs core:** could genuinely be a plugin — `window.Blinko.api` (per `docs/PROJECT_BRIEF.md` §4) is the same tRPC client the core app uses, so a plugin could query notes by date range and render via `addCardFooterSlot`-style hooks, or (better fit visually) it needs to render *above* the editor, which — per workstream 3's finding that additive hooks only render inside already-open surfaces — likely means checking whether there's an editor-header/footer slot equivalent (`addEditorFooterSlot` is mentioned in workstream 3's plugin hook list) before assuming core-file. Worth a quick spike to confirm `addEditorFooterSlot` renders above/below the compose box specifically before committing to plugin vs. core.
**Starting points:**
- `server/routerTrpc/note.ts` — check for an existing date-range query to reuse (e.g. whatever backs the heatmap/calendar view) before writing a new one.
- `app/src/store/plugin/pluginApiStore.tsx` — confirm `addEditorFooterSlot`'s actual render position.
- If core-file needed: `app/src/components/BlinkoEditor/index.tsx` — a small query + conditional render above the `<Editor>` in create mode only.

### 3.6 New idea: Send micro-interaction (animation, not sound)

**Verdict: nice-to-have, smallest scope of anything here, pair with 3.2 rather than standalone.**

A satisfying small animation on send (e.g. the existing `SendIcon` in `SendButton/index.tsx` already rotates on hover — `group-hover:rotate-[-35deg]` — extending that into an actual send animation, or a brief "ink absorbing into paper" fade-out of the editor content) is cheap because the send choke point (`handleSend()`, §1g) is already identified and there's already a hover micro-interaction to build on stylistically. Lowest priority of the list — it's polish on top of 3.2's finish-chime, not a distinct feature.

**Scope:** small. **Plugin vs core:** core-file, trivial (CSS/animation only, `SendButton/index.tsx` and/or `handleSend()`).

### 3.7 Ideas considered and deliberately not recommended

- **Ambient/ASMR background sound while recording or writing** (from the
  brief's "angles to consider" list): considered, but recommend against for
  this app specifically. Ambient loop-while-writing sound is a good fit for
  apps designed around long focused writing sessions; this app's identity
  (per `docs/PROJECT_BRIEF.md`) is voice-first, fast, frictionless capture —
  looping ambient audio during a 30-second voice memo adds setup/config
  surface (volume, track choice, a settings panel) disproportionate to the
  moment it's serving, and risks bleeding into the voice recording's audio
  track if not carefully isolated. The one-shot start/finish chime (§3.2) is
  the right-sized version of "sound as a personal touch" for this app.
- **Weather/auto-context tagging** (brief's "today's weather/mood" idea):
  mood is already covered by AI tagging (§1h). Weather would need a new
  external data source (violates the "0% cloud calls" hard constraint in
  `docs/PROJECT_BRIEF.md` §3 unless self-hosted, e.g. a local weather API tied
  to reverse-proxy egress rules from workstream 7) for a payoff that's
  marginal next to what mood tags already deliver. Not worth it unless the
  user specifically wants it later.
- **Streak/momentum indicator**: grepped, doesn't exist yet. Reasonable idea
  in general, but it's a *habit-gamification* feature, not a *personalization*
  feature — different goal than "feel more personal," closer to "feel more
  like Duolingo." Left out of this doc's scope; flag separately if wanted.

## 4. Ranked shortlist (top recommendations)

Ranked by (personal-feel payoff) ÷ (implementation risk + scope), using the
research above:

1. **Per-entry font choice, warm serif/handwriting (§3.4)** — highest
   payoff-per-effort. Global version is config-only; per-entry version is a
   small, well-understood `metadata` read/write following patterns already
   proven in this codebase (workstream 5's font/theme findings). Start:
   `prisma/defaultFonts.ts` (seed fonts) → `PerferSetting.tsx`'s
   `FontSwitcher` (picker reference) → `metadata.personalization.fontId` in
   `editorStore.tsx` → apply in `BlinkoCard/index.tsx` + `BlinkoEditor/index.tsx`.

2. **Finish/start sound (§3.2, the starter idea)** — small, isolated,
   two clean choke points already identified (`AudioDialog`'s
   `startRecording`, `EditorStore.handleSend()`), no competing system to work
   around. Use an intentional pencil-scratch/page-turn sound, not a generic
   chime, and gate behind a mute toggle in `PerferSetting.tsx`.

3. **Per-entry cover image (§3.3, new idea)** — reuses the existing upload
   pipeline entirely; the only genuinely new work is a "mark as cover"
   affordance and two render sites. Also revives the already-written but
   dead `gradientPairs` fallback in `cardBlogBox.tsx` for free visual variety
   on entries without a cover photo.

4. **Warm pattern/color background, scoped down from the starter idea
   (§3.1)** — recommend building the *textured-paper-pattern* and
   *solid-accent-color* versions, explicitly **not** full photo backgrounds
   behind text (legibility risk, tonal mismatch with the warm-paper identity
   already established in workstream 5). Reuses `ThemeColor.tsx`'s
   picker pattern, scoped to `metadata` instead of global config.

5. **"On this day" callback (§3.5, new idea)** — smallest scope, no data
   model change, well-precedented in real journaling apps as a top-loved
   feature. Worth a quick spike on `addEditorFooterSlot`'s exact render
   position before deciding plugin vs. core; either way it's cheap.

*(§3.6, the send micro-animation, is worth doing but only as a small
add-on alongside #2, not a standalone pick — noted for completeness, not
ranked in the top 5.)*

## 5. What NOT to build, explicitly

- Full user-uploaded **background** images rendered behind entry text (§3.1) —
  legibility/contrast risk against arbitrary photos, and tonally closer to a
  generic customizable-SaaS-dashboard feature than a journal one. If the user
  still wants this after reading the reasoning above, scope it as "cover
  image with heavy scrim + max-brightness clamp," not a raw photo backdrop.
- Reusing `GradientBackground.tsx`/`customBackgroundUrl` (§1b) for the entry
  page — it's a 3D animated shader gradient, built for auth/marketing
  screens, and wrong in both mechanism (global, not per-entry) and tone
  (animated WebGL, not warm-paper) for this ask.
- A new parallel mood-picker UI (§1h) — mood already surfaces via AI tagging;
  building a manual picker would compete with, not complement, a pipeline the
  project already invested in (workstream 4).
