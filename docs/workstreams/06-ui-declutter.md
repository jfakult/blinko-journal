# Workstream 6 — UI Declutter

Hides Blinko UI surfaces that make sense for a general-purpose multi-feature
notes app but are irrelevant to this fork's actual use case: a single-user
(single Pocket-ID login, no account sharing — see
[00-multi-user-model.md](00-multi-user-model.md)) personal voice journal.

**Delivered as a plugin, not a core edit**, per the brief's "prefer the
plugin system over modifying core files" constraint: `plugins/journal-declutter/`
(source only — not built, not installed; see its README for the build/install
steps, deferred to whoever deploys this on the real server). The plugin ships
one CSS file with `display:none` rules; it has no runtime logic beyond
registering itself with the plugin host.

A handful of items had no pre-existing stable CSS selector to hang a rule off
of, so this workstream also made small, isolated `app/src` patches — each
marked `// CUSTOM-JOURNAL:` — that do nothing but expose a selector (a data
attribute, an existing-but-unused className prop, or a wrapper div). No
behavior changes; every patch is additive and trivially revertable.

## Method

For each item, the actual DOM structure was read from source
(`app/src/components/Layout/*`, `app/src/components/BlinkoSettings/*`,
`app/src/pages/settings.tsx`, `app/src/App.tsx`) rather than guessed, per the
brief's caution that HeroUI/Tailwind components often lack meaningful stable
classnames. Plugin CSS-loading mechanics were confirmed by reading
`server/routerTrpc/plugin.ts` (`getPluginCssContents` / `scanCssFiles`: any
`*.css` file anywhere inside a plugin's installed directory is auto-injected
as a `<style>` tag — no explicit registration call needed) and
`app/src/store/plugin/pluginManagerStore.ts`.

## What's hidden, and how

| # | Item | Approach | Selector |
|---|------|----------|----------|
| 1 | Floating music mini-player | CSS only (no patch) | `.fixed.top-3.z-50.bg-none.select-none` |
| 2 | Settings → Music Settings tab (desktop) | Core patch + CSS | `button[data-settings-key="music"]` |
| 2b | Settings → Music Settings tab (mobile) | CSS only, relies on HeroUI behavior — see caveat below | `[data-key="music"]` |
| 3 | MCP server settings (inside Settings → AI) | Core patch + CSS | `.cj-hide-mcp` |
| 4 | Per-note "export as RSS" icon | Core patch + CSS | `.cj-hide-rss-export` |
| 5 | Telegram community link (Settings → About) | Core patch + CSS | `.cj-hide-telegram` |
| — | Plugin-manager visibility for non-admin | Already correct in core — no action | n/a |
| — | Follow/federation (`BlinkoFollowDialog`) | Already unreachable via nav — no action | n/a |

### 1. Music mini-player (`app/src/components/BlinkoMusicPlayer/index.tsx`)

Rendered globally as `<BlinkoMusicPlayer />` in `app/src/App.tsx` (a sibling
of the router, always mounted), but its root only appears in the DOM when
`musicManager.showMiniPlayer && currentTrack` — i.e. a track is actively
playing. In normal single-user journal use nothing ever triggers that (the
only thing that starts it is playing an audio *attachment* via
`app/src/components/Common/AttachmentRender/audioRender.tsx`'s "add to
playlist" action — the ordinary inline voice-memo playback controls on that
same component do **not** touch `musicManager` and are left completely
untouched, since that's core voice-journal functionality). Hidden anyway as a
defensive measure.

Selector: the component's root node has
`className="fixed top-3 left-[50%] z-50 w-fit md:w-[450px] rounded-2xl bg-none select-none"`.
Used the non-bracket subset (`fixed`, `top-3`, `z-50`, `bg-none`,
`select-none`) as a combined selector — distinctive enough as a set to be
unlikely to collide with other fixed-position elements (toasts/dialogs use a
different utility mix), and avoids escaping the bracketed arbitrary-value
classes (`left-[50%]`, `md:w-[450px]`) in CSS.

No core patch needed — Spotify metadata config (Settings → Music Settings,
item 2) is separate and handled below.

### 2. Settings → Music Settings tab

`app/src/pages/settings.tsx` drives both the desktop and mobile settings tab
lists from one `allSettings` array (`key: 'music'`, `requireAdmin: true`,
component: `<MusicSetting />` — confirmed by reading `MusicSetting.tsx`: it's
purely Spotify-consumer-key config for track metadata lookup, unrelated to
voice-memo playback).

**Desktop** (`app/src/pages/settings.tsx` ~line 224): tabs render as plain
`<button>` elements generated from the array with no distinguishing DOM
attribute (only a shared Tailwind class string and a `key={item.key}` *React*
key, which never reaches the DOM). Patched:

```tsx
// CUSTOM-JOURNAL: stable selector for the journal-declutter plugin
// to hide specific settings tabs via CSS (plugins/journal-declutter).
data-settings-key={item.key}
```

on the button, then `button[data-settings-key="music"] { display: none !important; }`
in the plugin CSS. (Same attribute exists on every tab — including `plugin` —
but only `music` has a hide rule; see the "plugin-manager" row below for why
`plugin` is deliberately left alone.)

**Mobile** (`app/src/components/Common/ScrollableTabs/index.tsx`): tabs are
rendered via HeroUI's `<Tabs>`/`<Tab key={item.key} .../>`. No patch was made
here — HeroUI (NextUI-derived) is documented/commonly known to reflect each
`Tab`'s `key` as a `data-key` attribute on the rendered button, so
`[data-key="music"]` should work without touching this shared component
(which is also used elsewhere, e.g. `hub.tsx`, for unrelated tab groups —
patching it directly would have had wider blast radius than necessary).
**This relies on a HeroUI implementation detail that was not verified against
a running build** (no bun/dev server per this workstream's constraints) —
flagged for a visual check after deploy. If it turns out `data-key` isn't
present, the fix is the same pattern used for #2 desktop: add
`data-settings-key` to the `Tab` in `ScrollableTabs`, gated so it only applies
when the item key matches (since that component is shared).

### 3. MCP server settings (`app/src/components/BlinkoSettings/AiSetting/AiSetting.tsx`)

Not its own settings tab — it's two elements (`<McpServersSection />` +
a `<CollapsibleCard title="MCP Integration">`) embedded inline in the `ai`
settings tab, alongside AI provider/model config that must stay visible (the
project brief explicitly keeps AI/transcription/tagging config). Patched:

```tsx
<div className="cj-hide-mcp">
  <McpServersSection />
</div>

<CollapsibleCard icon="hugeicons:api" title="MCP Integration" className="cj-hide-mcp">
```

`CollapsibleCard` already accepted a `className` prop (unused at this call
site before); `McpServersSection` doesn't take one, hence the wrapper div.
CSS: `.cj-hide-mcp { display: none !important; }`.

### 4. Per-note "export as RSS" icon (`app/src/components/BlinkoCard/cardHeader.tsx`)

**There is no dedicated "RSS reader" feature in this codebase.** Searched
thoroughly (`grep -rli rss` across `app/src` and `server`) — the only
RSS-related UI is this small icon (`mingcute:rss-2-fill`), shown only when
`isShareMode` is true (i.e. viewing a note on a public share/blog page, not
in the normal single-user home feed), which opens
`/api/rss/<accountId>/atom` in a new tab. `server/routerExpress/rss.ts` is
the Atom-feed endpoint it points at. Given how rarely this fork's single user
will use note sharing at all, this is low-value clutter rather than a
meaningful "reader" feature — hidden as the closest match to the brief's ask.

The shared `<Icon>` component (`app/src/components/Common/Iconify/icons.tsx`)
renders a bare inline `<svg>` via `dangerouslySetInnerHTML` with no
`data-icon` or similar attribute — confirmed by reading its full render path
— so there was no way to select this specific icon via CSS. Patched by adding
a class to the *already-existing* wrapping `<div>` (one word added to an
existing className string, no new elements):

```tsx
<div className="flex items-center gap-2 cj-hide-rss-export">
```

CSS: `.cj-hide-rss-export { display: none !important; }`.

### 5. Telegram community link (`app/src/components/BlinkoSettings/AboutSetting.tsx`)

**There is no "Telegram bot settings" feature in this fork's core either.**
Searched (`grep -rli telegram`) — the only real hit is a community-chat link
(`https://t.me/blinkoEnglish`) in the About page's "Community" section,
alongside GitHub and Discord links. (The other hits are a UI-style code
comment — "Voice message component (Telegram-style)" — and one i18n string
mentioning Telegram bots as an example use case for low-permission API
tokens; neither is a settings surface.) Hidden this link as the closest match
to the brief's intent, since community/chat links aren't useful on a private
single-user instance. GitHub and Discord links were left alone — brief named
Telegram specifically.

`Item` (`app/src/components/BlinkoSettings/Item.tsx`) already accepted an
unused `className` prop at this call site. Patched:

```tsx
<Item
  className="cj-hide-telegram"
  leftContent={<>Telegram</>}
  ...
```

CSS: `.cj-hide-telegram { display: none !important; }`.

### Plugin-manager visibility for non-admin accounts — no action needed

Already correctly handled in core: `app/src/pages/settings.tsx` filters
`allSettings` by `!setting.requireAdmin || user.isSuperAdmin`, and the
`plugin` entry has `requireAdmin: true`. Since this is a single-user,
single-admin deployment (see `00-multi-user-model.md` — there is no second,
non-admin account), the one account *is* the admin and needs the Plugin
Settings tab to install/manage `journal-declutter` itself. Deliberately
**not** hidden.

### Follow / federation (`BlinkoFollowDialog`) — no action needed

`BlinkoFollowDialog` (`app/src/components/BlinkoFollowDialog/`) is used in
exactly one place: `app/src/pages/hub.tsx`, behind the `/hub` route. Checked
every nav surface — `Sidebar.tsx`, `MobileNavBar.tsx`,
`UserAvatarDropdown.tsx` (all driven from `baseStore.routerList`, which does
not include a `hub`/`follow`/`site` entry), and `Layout/index.tsx` — none of
them link to `/hub`. It's only reachable by typing the URL directly. Nothing
to hide; noted here so a future reviewer doesn't wonder why it's missing from
the plugin CSS.

## Files touched

- `plugins/journal-declutter/plugin.json`, `src/index.tsx`, `src/style.css`,
  `package.json`, `vite.config.ts`, `tsconfig.json`, `README.md` (new —
  source only, not built or installed)
- `app/src/pages/settings.tsx` — `// CUSTOM-JOURNAL:` `data-settings-key` attribute
- `app/src/components/BlinkoSettings/AiSetting/AiSetting.tsx` — `// CUSTOM-JOURNAL:` MCP wrapper/className
- `app/src/components/BlinkoCard/cardHeader.tsx` — `// CUSTOM-JOURNAL:` RSS icon wrapper className
- `app/src/components/BlinkoSettings/AboutSetting.tsx` — `// CUSTOM-JOURNAL:` Telegram item className
- `docs/workstreams/06-ui-declutter.md` (this file)

## Deferred to deploy time (per this workstream's scope — no dev server, no bun/npm)

- Actually building `plugins/journal-declutter` (`bun install && bun run build`)
  and confirming the hand-written `vite.config.ts` produces a working
  SystemJS bundle — flagged with a caveat in the plugin's own README; if it
  doesn't work, re-scaffold with the official `blinko-cli` and copy the
  three source files over.
- Visually confirming every hide rule actually hits its target once the app
  is running and the plugin is installed — nothing in this workstream was
  visually or functionally verified, per instructions.
- Confirming the `[data-key="music"]` mobile-tabs assumption about HeroUI's
  `Tab` rendering (see item 2b above).
