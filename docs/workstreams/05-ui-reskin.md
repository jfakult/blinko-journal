# Workstream 5 — UI Reskin (vocabulary + warm theme)

Branch: `feature/ui-reskin`. Pure code/config change — no dev server was run, no
screenshots were taken (out of scope per the task; visual verification is deferred
to whoever runs this on the actual server). This doc exists so a human reviewer
knows what to expect without needing a screenshot.

## 1. Vocabulary choice

**Chosen term: "Entry" / "Entries"**, replacing the generic note-app nouns
"Note(s)" and the Blinko-specific "Blinko" (Blinko's own name for its quick-capture
note type).

Why "Entry" over "Moment" or something else: a journal's day-to-day unit of content
is most naturally called an "entry" in plain English ("write in your journal" →
"an entry"). "Moment" reads more like a social/photo-feed app (Instagram-adjacent)
and undersells the fact these are often full journal writing, not just quick
snapshots. "Entry" is warm without being cute, and it doesn't fight the voice-first
framing from the project brief ("record an entry").

### A wrinkle worth knowing about: Blinko has *two* note types

Blinko's editor toggles between two content types via `NoteType.BLINKO` and
`NoteType.NOTE` (see `app/src/components/Common/Editor/Toolbar/NoteTypeButton/index.tsx`
and `shared/lib/types.ts`). The `BLINKO` type is the quick-capture "flash" type
(lightning-bolt icon, yellow), the `NOTE` type is the longer-form type. Both used
the generic English word "Note"/"Notes" in various places, and the `BLINKO` type
specifically used the string "Blinko" as its display label (i18n key `"blinko"`).

To keep the two types distinguishable after the rename, I mapped them as:
- `NoteType.NOTE` → **"Entry"** (i18n key `note`, and the general plural `notes` → "Entries")
- `NoteType.BLINKO` → **"Quick Entry"** (i18n key `blinko`)

This preserves the existing UX distinction (a fast jot vs. a fuller entry) using
consistent journal vocabulary instead of the app's internal code name leaking into
the UI. All paired strings were updated to match, e.g.:
- `convert-to-note` "Convert to Note" → "Convert to Entry"
- `convert-to-blinko` "Convert to Blinko" → "Convert to Quick Entry"
- `add-to-note` "Add to Note" → "Add to Entry"
- `add-to-blinko` "Add to Blinko" → "Add as Quick Entry"
- `task-name-auto-archive-blinko` / `schedule-archive-blinko`: these labels turned
  out to refer to a real backend job (`server/jobs/archivejob.ts`) that auto-archives
  notes of type `BLINKO` specifically after N days — so these became "Auto Archive
  Quick Entries" / "Schedule Archive Quick Entries", which is more accurate than the
  original label was.

### What was deliberately left alone

Per the brief, "Blinko" was only replaced where it was standing in for the noun
"entry/note." Where "Blinko" is genuinely the *product name* (this fork is still
built on Blinko under the hood), it was left as-is:
- `powered-by-blinko` "Powered by Blinko" (footer credit — still true)
- `site-url` / `blinko-endpoint` / `enter-blinko-endpoint` (admin-only deployment
  config, referring to the Blinko instance itself)
- `use-blinko-hub`, `home-site`, and all `follow`/`follower`/`following`/
  `followed-you` strings — these belong to Blinko's cross-instance federation
  ("Hub") feature, which is unrelated to the note-noun question and explicitly
  out of scope for this single-user journal (see
  `docs/workstreams/00-multi-user-model.md`). Per the task instructions, these were
  intentionally left as low-key admin-only strings rather than promoted into
  journal vocabulary — "Follow" should not read as a prominent journal concept.
- `ask-blinko-ai-about-this-query` / `ai-conversation-share` — "Blinko AI" is the
  branded name of the AI assistant feature, not the note noun.
- Placeholder/example text that happens to contain "Blinko" (e.g. the sign-in
  footer placeholder linking to blinko.space) — illustrative text, not app copy.

Also touched a few adjacent strings that were clearly part of the same
"this is a notes app" framing even though they didn't literally contain "note":
the empty-state message (`no-data-here-well-then-time-to-write-a-note`, "No data
here~" → "Nothing here yet~ Time to write an entry.") and the microphone-permission
prompt ("To record audio notes..." → "To record voice entries...", matching the
brief's voice-first framing).

**File touched:** `app/public/locales/en/translation.json` only (English locale;
other language files under `app/public/locales/<lang>/` were left untouched per
the task instructions — this fork doesn't maintain translations, and leaving them
alone doesn't break them, it just means non-English UIs keep the old wording).
Only string *values* were changed, never JSON keys — the keys are referenced by
`t('key')` calls throughout the React code, so renaming keys would have required
updating every call site for no benefit. Validated the file re-parses as valid
JSON with the same key count (841) after editing.

## 2. Theme: DB-driven vs. static CSS (what I found)

This turned out to be **both**, and the interaction between them mattered:

- **Bulk of the visual identity (backgrounds, cards, borders, tags, popovers,
  hover states, scrollbar, code/markdown editor chrome, shadows) is static CSS**,
  defined as CSS custom properties in `app/src/styles/globals.css` under
  `:root` (light) and `.dark` (dark mode), consumed via `app/tailwind.config.js`'s
  `colors: { ... : 'var(--foo)' }` mapping. There is no DB config for any of these
  — they're pure source-controlled defaults.

- **`--primary` / `--primary-foreground` specifically are DB-driven at runtime**,
  via the `themeColor` / `themeForegroundColor` keys in the `Config` table
  (`server/routerTrpc/config.ts`, admin-settable through Settings → Preference →
  Theme Color, UI component `app/src/components/Common/Theme/ThemeColor.tsx`).
  **Important gotcha:** even when no admin has ever touched that setting (the
  common case for a fresh single-user instance — there's no seed/migration that
  pre-populates a `themeColor` config row), `app/src/store/user.ts`
  (`initializeSettings`, around line 293) still runs on every page load and
  **unconditionally overwrites the `--primary`/`--primary-foreground` CSS custom
  properties with hardcoded JS fallback values** (previously `#f9f9f9`/`black` for
  dark/light) via `element.style.setProperty(...)` — inline styles, which beat
  the CSS file's own `:root`/`.dark` rules in specificity. The same fallback
  literals are duplicated in `PerferSetting.tsx`'s `onChange` handler (used when
  the admin clears the picker).

  **Practical effect: editing only `globals.css`'s `--primary` value would have
  had zero visible effect**, since the JS-set inline style always wins over the
  CSS file default. This is exactly the kind of read-the-code-don't-assume trap
  the task called out.

**What I actually changed, given this:**
1. Rewrote the full warm "paper & ink" palette in `app/src/styles/globals.css`
   (both `:root` and `.dark` blocks) — this covers everything *except* `--primary`.
2. Updated the hardcoded fallback literals in `app/src/store/user.ts` and
   `app/src/components/BlinkoSettings/PerferSetting.tsx` to the same warm accent
   colors, so `--primary` matches even with no DB config row present (the
   single-user default case). Both edits are marked `// CUSTOM-JOURNAL:` since
   they're small, unavoidable core-file touches (data-file/CSS edits weren't
   enough on their own) rather than a pure config/seed change.
3. Left the DB-driven `themeColor`/`themeForegroundColor` mechanism itself
   completely untouched — the admin can still override the accent color live from
   Settings → Preference without needing another code change, exactly as before.

No seed/migration was added to pre-populate a `themeColor` DB row — the JS fallback
literal change (step 2) achieves the same "warm by default" outcome for a fresh
instance without touching the database layer, and stays effective even after a
`prisma migrate reset`.

## 3. Plugin-based i18n override — considered, not used

Blinko's plugin API exposes `window.Blinko.i18n`, and it is literally the app's
live i18next instance (`app/src/store/plugin/index.ts`: `i18n: typeof i18n` where
`i18n` is imported from `@/lib/i18n`). This means a plugin genuinely *could* have
overridden these strings at runtime with no core-file edits at all, e.g.:

```js
window.Blinko.i18n.addResourceBundle('en', 'translation', {
  blinko: 'Quick Entry',
  notes: 'Entries',
  // ...
}, true, true);
```

**I chose a direct file edit instead, for a few reasons:**
- Per the brief, "prefer the plugin system over modifying core files" is explicitly
  about *core logic* — the locale JSON is data, not logic, and the brief itself
  flags this distinction as the reason a direct edit is "likely fine."
- The plugin route would mean maintaining a second, parallel list of ~40 key/value
  overrides in a JS file, kept in sync by hand with whatever the upstream JSON
  says — strictly *more* long-term maintenance than editing the JSON once, which
  cuts against the brief's stated "minimum long-term maintenance" goal.
- A locale JSON diff is about as small and mergeable a core-file change as exists
  in this codebase — conflicts on `git merge upstream/main` would be limited to
  whichever specific string values upstream also happens to touch, which is easy
  to resolve by re-applying this same word swap.
- The plugin approach would also need to run early enough (before first render of
  every namespace) to avoid a flash of the old English strings, and would need to
  handle i18next's async namespace loading — solvable, but extra moving parts for
  no real benefit in a private single-user fork.

If a future workstream needs to override strings *without* a code change at all
(e.g. distributing this as an installable plugin for other Blinko users rather
than a fork), `window.Blinko.i18n.addResourceBundle` is the documented hook to
reach for.

## 4. What the reskin looks like now (plain-language description)

No screenshots were taken (explicitly deferred to whoever runs this on the
server). Here's what to expect:

**Vocabulary:** Every place the UI previously said "Note" or "Notes" now says
"Entry" or "Entries" — the sidebar/heat-map labels, the AI chat assistant's
references to "your notes," empty states, tag-deletion confirmations, the note
history panel ("Entry History"), related-content panels, etc. The quick-capture
note type (lightning-bolt icon) is now labeled "Quick Entry" instead of "Blinko"
throughout — the toolbar tooltip, the right-click "Convert to" menu, and the AI
chat box's "add" button. The app's own product name ("Blinko") still appears in a
handful of admin-only/branding spots (footer credit, SSO/API endpoint labels,
sign-in footer placeholder) since this is still Blinko software under the hood —
just not exposed as everyday journal vocabulary.

**Color/theme:** The interface no longer looks like a gray/white "productivity
SaaS" tool. In light mode, backgrounds are a warm cream/paper tone (`#fbf6ec`
main background, `#f3e9d8` for secondary surfaces like the sidebar, `#fffcf5` for
cards) instead of stark white/light-gray. Body text is a warm dark brown ink
(`#33261c`) instead of neutral near-black. Borders, hover states, and the
scrollbar are warm tan instead of cool gray. Tags are now a warm terracotta/amber
(`#c1712f`) instead of purple. The primary accent color (used for buttons, links,
the focused-tag highlight, and the scrollbar thumb) is a warm burnt-terracotta
(`#b5541f`) in light mode. Text selection highlighting is a warm honey/amber
instead of bright blue.

Dark mode mirrors this with a warm near-black brown background (`#1c1611`,
instead of the previous neutral-black `#0b0b0c`), warm cream text (`#ede0cb`),
amber tags, and a warm gold/amber primary accent (`#e8b074`) instead of plain
white.

The overall effect should read as "warm paper and ink" rather than "cold
neutral-gray dashboard" — closer to a physical journal's aesthetic than a
note-taking/PKM tool's. An admin can still override just the accent color live
from Settings → Preference → Theme Color if the defaults aren't to taste; that
picker was left fully functional and unchanged.

**Not changed:** typography/font (`--font-family` still `'Inter', sans-serif`),
layout, spacing, iconography, or the destructive/error red — those were out of
scope for a color-only reskin and touching fonts felt like a separate, riskier
decision than the task asked for.
