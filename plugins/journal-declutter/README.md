# journal-declutter

A CSS-only Blinko plugin that hides UI surfaces irrelevant to a single-user
personal voice journal deployment: the music mini-player, the Music Settings
tab, MCP server settings, the Telegram community link, and a per-note RSS
export icon. See `../../docs/workstreams/06-ui-declutter.md` in the main repo
for the full rationale, every selector used, and the handful of small
`// CUSTOM-JOURNAL:`-marked core patches this plugin depends on to have
something stable to hide.

This plugin does **not** touch `window.Blinko.api`, does not read or write
any notes/data, and makes no network calls. It only ships `src/style.css`,
which the Blinko plugin host auto-loads.

## Prerequisites (per the project's Workstream 6 brief)

The three-ish patches this plugin's CSS relies on (`data-settings-key` on the
Settings desktop tab buttons, the MCP section wrapper, the RSS icon wrapper
class, the Telegram `Item` className) must already be present in the running
Blinko instance's core files — they are **not** part of this plugin package,
they live in the main app under `app/src/`, marked `// CUSTOM-JOURNAL:` so
they're easy to find on an upstream merge. If those patches aren't in the
build you're deploying against, this plugin's Music-tab, MCP, RSS-icon, and
Telegram rules will silently no-op (the mini-player and Plugin-tab-left-alone
rules don't need them and will still work).

## Build

This repo does **not** run `bun install` or any build step for you — do that
on whatever machine you deploy from:

```bash
cd plugins/journal-declutter
bun install
bun run build
```

That should produce `release/index.js` (a SystemJS-format bundle — see the
caveat comment at the top of `vite.config.ts`: Blinko loads plugins via
`System.import(...)`, and this hand-written config targets Rollup's built-in
`system` output format to match, but wasn't verified against a running
`bun run build` since this workstream is pure-code, no-build-tools by design).

**If `bun run build` errors or produces something that doesn't load** (check
the browser console for `[journal-declutter] loaded` after installing —
absence of that log, or a SystemJS import error, means the bundle format is
wrong): scaffold a fresh plugin with the official tooling referenced from
https://docs.blinko.space/en/plugins/get-started.md (a `blinko-cli`, per
https://docs.blinko.space/en/plugins/publish-plugin.md), then copy
`plugin.json`, `src/index.tsx`, and `src/style.css` from this directory into
that scaffold and build with its config instead of debugging this one blind.

## Package for install

Blinko's "Install from GitHub" flow (Settings → Plugins) downloads
`<repo-url>/releases/download/v<version>/release.zip` and extracts it into
`.blinko/plugins/journal-declutter/`, then does `System.import('/plugins/journal-declutter/index.js')`
and separately auto-loads **every** `*.css` file found anywhere in that
extracted directory as a `<style>` tag (no explicit registration needed —
see `pluginManagerStore.ts::loadCssFiles` in the main app). Concretely:

```bash
cd release
zip -r ../release.zip .
cd ..
```

The zip's root must contain `index.js` (from the build) — dropping
`src/style.css` into `release/` before zipping (or otherwise including a
`.css` file anywhere in the archive) is enough for it to be picked up; it
does not need to be referenced from `index.js`.

## Install into a running Blinko instance

Two paths exist in this fork (confirmed by reading
`app/src/components/BlinkoSettings/PluginSetting.tsx` and
`server/routerTrpc/plugin.ts` — there is no separate raw file-upload endpoint,
despite that being mentioned as a possibility elsewhere; only these two):

1. **Production install (GitHub Release URL):**
   - Tag a release on your fork/plugin repo as `v<version>` (matching
     `plugin.json`'s `version` field) and attach `release.zip` (built above)
     as a release asset.
   - In Blinko: **Settings → Plugin Settings → Install from GitHub**, paste
     `https://github.com/<owner>/<repo>`. Blinko resolves the latest release
     tag itself and downloads `.../releases/download/v<version>/release.zip`.
   - Confirm the plugin shows as installed and enabled; hard-refresh the page
     so the newly-injected `<style>` rules take effect app-wide.

2. **Local development / testing before a real release:**
   - Blinko's Settings → Plugin Settings → *Local Development* tab connects
     to a websocket dev server (`ws://<host>:8080`) that live-pushes your
     plugin's files without needing a GitHub release. See
     https://docs.blinko.space/en/plugins/get-started.md (`bun dev` /
     `bun ngrok` if the dev server needs to reach a remote Blinko instance).
     This repo's `package.json` `dev` script is a placeholder — check the
     current docs/CLI for the real dev-server command before relying on it.

## Uninstall / verifying it's off

Settings → Plugin Settings → remove the plugin, then hard-refresh. Since this
plugin only adds `display:none` CSS rules (nothing is deleted or disabled
server-side), removing it immediately restores every hidden nav item and
setting.
