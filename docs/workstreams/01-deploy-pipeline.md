# Workstream 1 — Repo Fork & Deployment Pipeline

Scope: retarget the Docker image/build pipeline to our fork, wire up the
production compose stack for the real deployment target
(`fakult.net/journal`, Pocket-ID SSO at `sso.fakult.net`), investigate GitHub
issue [blinkospace/blinko#1023](https://github.com/blinkospace/blinko/issues/1023)
("Unable to SSO with Pocket-ID"), and resolve the subpath/routing question.
This is single-user (one Pocket-ID login) - see
[00-multi-user-model.md](00-multi-user-model.md) - so there's no
multi-account provisioning here.

This was pure code/config work: no docker build, no `bun install`, nothing
run live. Everything below is a conclusion reached by reading the actual
source, not by testing against a live Pocket-ID instance.

## 1. Is #1023 still reproducible on current `main`?

**Short answer: the bug class described in #1023 looks fixed for the normal
admin workflow. It can still be *triggered* by user misconfiguration, and I
found two adjacent, previously-unnoticed bugs in the same code path that
would independently break Pocket-ID login even with the fix in place - both
patched (see §4).**

### What #1023 describes

"Unknown authentication strategy 'pocket-id'" → Internal Server Error, when
attempting to log in via a custom Pocket-ID OIDC provider configured through
Settings → SSO → Custom Provider.

### What the current code does (`server/routerExpress/auth/config.ts`,
`server/routerExpress/auth/index.ts`)

Passport strategies for custom OAuth/OIDC providers are registered lazily,
keyed by `provider.id`, from `config.oauth2Providers` (a DB-backed config
value edited through the Settings UI - there's no env-var or boot-time-only
config path for custom providers). The relevant pieces:

- `ensureOAuthStrategies(providerId?)` (config.ts) is called at the top of
  **every** OAuth route handler - both the login-initiation route
  (`router.get('/:providerId', ...)` in index.ts) and the callback route
  (`router.get('/callback/:providerId', ...)`) - before `passport.authenticate()`
  is ever invoked. It lazily runs `initOAuthStrategies()` (reads
  `oauth2Providers` from config and calls `passport.use(id, strategy)` for
  each one) on first use, caches the result, and if the specific
  `providerId` requested still isn't registered afterward, throws a clear,
  controlled `Error('OAuth strategy "X" is not configured')` - rather than
  letting `passport.authenticate()` hit Passport's own internal "Unknown
  authentication strategy" throw.
- `reinitializeOAuthStrategies()` (config.ts) is called from the
  `config.update` tRPC mutation (`server/routerTrpc/config.ts`) whenever the
  admin saves the `oauth2Providers` key - i.e. every time you add/edit a
  provider in Settings → SSO. It unregisters all previously-registered
  strategies and resets the "initialized" flag, forcing the next request to
  lazily re-register from the fresh config.

Read together, this is exactly the fix for the most likely root cause of
#1023: **strategies were only ever registered once, at server boot, from
whatever `oauth2Providers` looked like at startup.** Since custom OIDC
providers are configured through the running app's Settings UI (there's no
way to pre-seed one before first boot), any provider added or edited after
boot would never be registered with Passport until the process restarted -
so logging in immediately after configuring Pocket-ID would hit
"Unknown authentication strategy" every time. The lazy-init +
reinitialize-on-save pair directly closes that gap: saving the provider in
Settings now invalidates the cache immediately, and the next login attempt
(initiation or callback) lazily (re)registers it on demand.

This fix landed in the "fix: follow-up fix based on #1131" commit (2026-05-31),
after #1023 was filed. Issue #1131 is a different, adjacent report, but the
`ensureOAuthStrategies`/`reinitializeOAuthStrategies` machinery it introduced
is the correct shape of fix for #1023's symptom too.

### What can still go wrong (and why you might still see this error)

The lazy-init fix does **not** protect against a `providerId` in the request
URL that simply doesn't match any configured provider's `id` - and it
shouldn't, since that's not a bug, it's user misconfiguration surfacing as
(now) a clean 500 instead of a crash. The **Provider ID field is a
free-text input, case-sensitive, with no normalization**
(`app/src/components/BlinkoSettings/SSOSetting.tsx` - `store.id = e.target.value`,
saved verbatim). It becomes both:

- the Passport strategy name Blinko registers internally, and
- the literal path segment in the callback URL Blinko constructs:
  `/api/auth/callback/${provider.id}`.

If what you type into Blinko's "Provider ID" field doesn't exactly match
(byte-for-byte, case-sensitive) the callback URL you register in Pocket-ID's
OIDC client settings, you will still see "Unknown authentication strategy" /
"Internal Server Error" - just now via a controlled error path
(`errorHandler` in `server/index.ts`, since this project runs Express 5,
which auto-forwards a rejected async-handler promise to error-handling
middleware) rather than an unhandled crash. See §3 for the exact values to
use so this can't happen.

**Conclusion: don't write a speculative patch for #1023 itself - the
mechanism it describes looks fixed. Get the Provider ID exactly right per §3
and it should not reproduce.** I did, however, find and fix two *different*,
concrete bugs in the same custom-OIDC code path while reading it closely for
this investigation - see §4.

## 2. Pocket-ID SSO configuration

Pocket-ID: `https://sso.fakult.net`. Blinko: `https://fakult.net/journal`.

### In Pocket-ID (create an OIDC client)

- **Callback / Redirect URL:** `https://fakult.net/journal/api/auth/callback/pocket-id`
  (exact string, must include the `/journal` prefix - see §4.1 for why this
  works correctly against a container that itself has no idea it's served
  under a subpath).
- Note the generated **Client ID** and **Client Secret** for the next step.

### In Blinko (Settings → SSO → Custom Provider)

| Field | Value |
|---|---|
| Template | Custom Provider |
| **Provider ID** | `pocket-id` — must be **exactly** this string (lowercase, hyphenated), because it's used verbatim, case-sensitively, both as the internal Passport strategy name and as the `{providerId}` path segment in the callback URL above. Any mismatch (`Pocket-ID`, `pocketid`, trailing space, etc.) reproduces the #1023 symptom (see §1). |
| Provider Name | `Pocket-ID` (display label only - free text, doesn't need to match Provider ID) |
| Provider Icon | any Iconify id, e.g. `simple-icons:pocketid` (cosmetic only) |
| Well-Known URL | `https://sso.fakult.net/.well-known/openid-configuration` |
| Authorization URL / Token URL / Userinfo URL | leave blank - discovered from the well-known URL above |
| Scope | `openid profile email` — **type this explicitly.** Leaving it blank *used to* silently produce a broken empty-scope strategy; that's now fixed (§4.2) so a blank field correctly falls back to Pocket-ID's advertised scopes, but there's no reason to rely on the fallback when the OIDC-standard value is one line. |
| Client ID | from Pocket-ID's client registration |
| Client Secret | from Pocket-ID's client registration |

After saving, Blinko calls `reinitializeOAuthStrategies()` automatically
(§1) - no restart needed before testing login.

### Env vars (see docker-compose.prod.yml)

```
NEXTAUTH_URL=https://fakult.net/journal
NEXT_PUBLIC_BASE_URL=https://fakult.net/journal
```

`NEXTAUTH_URL` is not cosmetic here - after the §4.1 patch it's what makes
the OAuth callback URL come out correct under the `/journal` subpath. Get it
wrong (missing, or missing the `/journal` suffix) and Pocket-ID login will
fail with a redirect_uri mismatch even though the Provider ID is correct.

## 3. Subpath deployment: proxy path-strip vs. router `basename`

**Conclusion: reverse-proxy path-strip (proxy strips `/journal` before
forwarding; the container serves everything as if it's at `/`). This is not
a judgment call between two equally-valid options - the codebase has no
subpath-awareness mechanism to hang a `basename` off of, so implementing
that option would mean auditing and changing routing in a large number of
files, which directly conflicts with the "minimum long-term maintenance,
prefer isolated changes" constraint in the project brief.**

Evidence gathered by reading the code (this app was refactored off Next.js -
see the "BREAKING CHANGE: refactor next.js to tauri" commit - so there is no
Next.js `basePath` concept at all; it's a Vite/React SPA + Express backend):

- `app/vite.config.ts` has no `base` option set (defaults to `/`).
- `app/src/App.tsx` wraps everything in a plain `<BrowserRouter>` with no
  `basename` prop; every `<Route path="...">` is root-absolute (`/`,
  `/signin`, `/detail/*`, ...), and `navigate(...)` calls throughout the app
  use root-relative paths.
- `server/index.ts` mounts every static asset and API route at a
  root-absolute path: `/api/auth`, `/api/trpc`, `/api/file`, `/api/rss`,
  `/v1`, `/api-doc`, `/plugins`, `/dist/js/...` (vditor/editor dependencies),
  the PWA manifest (`start_url: '/'`), etc.
- `NEXT_PUBLIC_BASE_URL` (the one env var whose name suggests it might do
  this) is not read anywhere in `app/src` or `server` - confirmed by grep.
  It's vestigial, a leftover from the pre-Tauri-refactor Next.js era, no
  different in effect from an unused variable.

Given all of that, adding real subpath support would mean introducing a
`base`/`basename` concept where none exists, then re-auditing every one of
the above mount points (plus the PWA manifest, service worker scope, and any
other hardcoded `/` reference) to consistently prefix them - a wide,
cross-cutting change to a fork we intend to keep mergeable with upstream.
The proxy-strip approach requires zero application changes for all of that:
the container is simply unaware it's being reached via a subpath, and every
one of those root-absolute mounts resolves correctly once the proxy has
already removed `/journal` from the path.

**The one place proxy-strip does *not* work for free: OAuth/OIDC callback
URLs.** See §4.1 - that's a real gap, not a hypothetical, and it's fixed
with a minimal, isolated patch rather than by complicating the proxy config
or reintroducing subpath-awareness into the app.

### Reverse proxy requirement

Whatever proxy sits in front of `fakult.net` needs one rule:
`https://fakult.net/journal/*` → strip the `/journal` prefix → forward to
`blinko-website:1111/*`. A single uniform strip rule for the whole path is
sufficient - no special-casing needed for `/api/auth/*` once §4.1's patch is
in place, because the callback URL the browser is redirected to is
constructed as a full, correct external URL up front (including `/journal`)
rather than being re-derived from the (already-stripped) incoming request
path.

## 4. Patches made (both marked `// CUSTOM-JOURNAL:` in `server/routerExpress/auth/config.ts`)

Both are narrow, additive, and isolated to this one file. Neither is a fix
for #1023 itself (see §1's conclusion that #1023's own mechanism looks
already fixed) - both are separate, concrete bugs found while reading this
code closely for the SSO investigation, and both would independently break
Pocket-ID login on this specific deployment (subpath + a real external OIDC
provider) if left as-is.

### 4.1 OAuth callback URL didn't account for the reverse-proxy subpath

`initOAuthStrategies()` built every strategy's `callbackURL` as a
**relative** path: `` `/api/auth/callback/${provider.id}` ``. `passport-oauth2`
(and everything built on it - github/google/facebook/twitter/discord/custom)
resolves a relative `callbackURL` against the *incoming request's own*
protocol/host/path (`passport-oauth2/lib/utils.js`'s `originalURL()`), not
against any configured public base URL. Under the proxy-strip setup from §3,
the request the container actually sees has already had `/journal` removed
- so the callback URL Passport hands to Pocket-ID as `redirect_uri` comes
out as `https://fakult.net/api/auth/callback/pocket-id`, silently missing
the `/journal` prefix that's actually registered in Pocket-ID (§2). Pocket-ID
would reject this as an invalid/mismatched redirect URI, breaking login -
independent of, and in addition to, anything in #1023.

**Fix:** build an absolute `callbackURL` from `NEXTAUTH_URL` when it's set
(`https://fakult.net/journal` + `/api/auth/callback/${provider.id}`),
falling back to the previous relative-path behavior when `NEXTAUTH_URL`
isn't set (so a root-deployed instance is unaffected). This is also the
first place in the codebase that actually reads `NEXTAUTH_URL` for anything
- confirmed by grep that nothing else in `server/` or `app/src` consumes it.

### 4.2 Blank Scope field silently produced an empty OAuth scope

The Custom Provider Scope field (`SSOSetting.tsx`) defaults to `''`
(empty string) when left blank - its placeholder text (`"email profile"`) is
just a UI hint, not an actual default value that gets saved. Both scope
fallback expressions were `provider.scope?.split(' ') || <fallback>`.
`''.split(' ')` evaluates to `['']` - a non-empty, truthy array - so the
`||` fallback only ever triggered when `scope` was literally `undefined`,
never for the realistic case of "admin left the field blank." The strategy
would then be registered with an effectively empty scope, which for a real
OIDC provider like Pocket-ID is enough to break login (no `openid` scope →
no ID token / no userinfo access).

**Fix:** added a small `parseScope()` helper that trims the input and treats
blank/whitespace-only scope as "not provided," so it correctly falls through
to `wellKnownConfig.scopes_supported` (from Pocket-ID's discovery document)
or the hardcoded default, matching the fallback logic's evident original
intent.

## 5. Deliverables in this branch

- `docker-compose.prod.yml` - retargeted to `ghcr.io/jfakult/blinko-journal:latest`,
  `NEXTAUTH_URL`/`NEXT_PUBLIC_BASE_URL` set to `https://fakult.net/journal`,
  switched the network from the upstream template's `driver: host` to a
  normal named bridge network (`blinko-network`) so service-name DNS works
  for `postgres` and the future `whisper` service, and uncommented/adapted
  the `postgres` service to run locally rather than pointing at a remote
  example IP. Ollama/Pocket-ID network reachability is called out as an open
  question inline (genuinely unknown from this repo - both run elsewhere on
  the Unraid host, outside this compose file).
- `.github/workflows/docker-build.yml` - retargeted from a stray feature
  branch trigger to `push: branches: [main]`, and from whatever
  `${{ github.repository }}` resolved to, to `jfakult/blinko-journal` on
  `ghcr.io`.
- `.env.tmpl` - left as local-dev defaults, with a comment pointing at
  `docker-compose.prod.yml` for the real production values so the two don't
  get confused.
- `server/routerExpress/auth/config.ts` - two isolated patches, both marked
  `// CUSTOM-JOURNAL:` (§4).
- This document.

## 6. Open questions for whoever deploys on the real Unraid server

- **Ollama/Pocket-ID reachability from this compose stack** - shared
  external Docker network vs. LAN IP is unknown from this repo; noted
  inline in `docker-compose.prod.yml`. Resolve on the actual host and set
  the corresponding endpoint URLs in Blinko's Settings UI (AI providers) and
  well-known URL (§2) accordingly.
- **Reverse proxy config** - needs the single path-strip rule described in
  §3. Not written here since the actual proxy (nginx? Traefik? Unraid's
  built-in reverse proxy manager?) isn't known from this repo.
- **End-to-end SSO test** - none of this was run live per this workstream's
  constraints (no docker/build/run). The conclusions above are from reading
  the code, not from an observed login. Test against the real Pocket-ID
  instance before considering this workstream fully done.
