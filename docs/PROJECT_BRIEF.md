# Project Brief: Blinko → Family Voice Journal

> Committed verbatim from the original brief given to the AI session that scaffolded this fork, so the context travels with the repo instead of living only in a chat transcript. See `docs/workstreams/` for per-branch findings and `README.md` for the branch map and how to sync from upstream.

Paste this whole document into the orchestrator. It is self-contained — no other context is assumed.

## 1. What we're building

A private, self-hosted journal for a small group of family and friends, where **voice recording is the primary way entries get created** — not an add-on. A person taps record, talks, and the system handles the rest: transcription, tagging, and making it searchable later. No one using the app day-to-day (family/friends) should need any technical skill.

**Original requirements this must satisfy:**
1. SSO login
2. Attractive, warm UI (not a "productivity tool" feel)
3. Fast, frictionless single-entry creation
4. Voice recording as the main entry method
5. Automatic transcription (no manual step)
6. Automatic AI tagging (no manual step)
7. Image uploads per entry
8. Location logging per entry
9. High-level analysis over time (locations, moods, trends)
10. Full-text/semantic search across entries

## 2. Why Blinko, and what's already decided (don't relitigate)

We evaluated several self-hosted journal-specific apps (Journiv, Nightlio, MoodHaven Journal, StoryPad, Trilium Notes) and general note tools. **Blinko** (`blinkospace/blinko`, AGPL-3.0, Next.js/TypeScript frontend + tRPC backend + LibSQL vector store) was chosen because it already has, natively, the hardest-to-build pieces:
- Native voice recording
- Native "auto-convert to text" transcription, gated behind an AI-provider config (works with any OpenAI-compatible endpoint, including self-hosted ones)
- Native Scheduled AI Tasks — cron-based jobs that auto-tag notes by content, no user interaction required
- Native RAG search (LibSQL vector store, natural-language queries), using a configurable embeddings provider
- Native location tagging
- Native image attachments
- Native custom OIDC/SSO provider support
- A real, documented plugin system (see §4) that avoids needing a deep fork for most customization

What it lacks natively, relative to our requirements: a warm "journal" visual identity (it looks like a general notes/PKM tool), and a dedicated locations/moods/trends analytics dashboard (only AI-generated summary text via "Daily Review," not a visual dashboard).

**This is settled — do not propose an alternative base app.**

## 3. Hard constraints

- **100% self-hosted, 0% telemetry, 0% cloud AI calls.** All LLM/embedding calls go to a local Ollama instance already running on the home server. All transcription goes to a self-hosted Whisper-compatible service (to be stood up as part of this project — see Workstream 2). Nothing may call OpenAI/Gemini/Anthropic/any cloud AI provider.
- **Deployment target:** a home Unraid server, via Docker / docker-compose. The server already runs Ollama (shared GPU — check capacity before adding heavy new GPU workloads), Immich, and will run Pocket-ID for auth.
- **Auth:** Pocket-ID (self-hosted OIDC provider, passkey-based). Blinko has a documented, officially-supported Pocket-ID integration path, but there is a known open bug report (blinkospace/blinko#1023, "Unable to SSO with Pocket-ID") — verify this works in our environment before assuming it's solved.
- **Minimum long-term maintenance is a primary goal.** Prefer Blinko's plugin system over modifying core application files, everywhere the plugin API allows it. Where a core-file change is genuinely unavoidable, keep it minimal, isolated to as few files as possible, and mark it clearly (e.g. `// CUSTOM-JOURNAL:` comment) so it's easy to spot during future upstream merges.
- **Audience assumption:** end users (family/friends) have zero technical skill and will only ever interact with a simple, obvious "record" action and a feed of entries. Anything requiring configuration, settings, or troubleshooting is for the instance admin (the person running this prompt) only.

## 4. Relevant technical facts (plugin system)

Blinko plugins get access to a `window.Blinko` global object exposing:
- `api` — the same tRPC client the core app uses (can create/read notes, tags, etc. directly)
- `toast`, `i18n`, `eventBus`, `store`
- `addToolBarIcon(...)` — add a custom toolbar button with custom panel content
- `addRightClickMenu(...)` — add custom context menu items
- Plugins may also ship their own `.css` files, which the frontend loads — useful for hiding/restyling existing UI without touching core components.

The plugin API is **additive** (add buttons/menus/styles) — there is no documented hook for removing or hiding native UI elements from application logic. CSS-based hiding is the workaround for that; deeper removal requires a small core patch.

## 5. Git / deployment workflow (all workstreams must follow this)

1. Fork `blinkospace/blinko` to our own GitHub account.
2. Add `upstream` remote pointing at `blinkospace/blinko` for periodic merges.
3. All work happens on feature branches off `main` (see branch names per workstream below).
4. A GitHub Action builds a Docker image from the fork and pushes it to `ghcr.io` on merge to `main`.
5. The Unraid docker-compose stack pulls our custom `ghcr.io` image tag (not the upstream `blinkospace/blinko` image).
6. Plugins live in their own directory/repo where possible and are installed through Blinko's plugin manager rather than merged into core.
7. Updating from upstream later: `git fetch upstream && git merge upstream/main`, resolve conflicts (should be small/rare given isolated edits), rebuild, re-push, redeploy.

## 6. Workstreams (assign to parallel subagents)

### Workstream 0 — Multi-user / Family Sharing Model Validation
**Priority: run this first — it may change the plan for other workstreams.**
- Stand up a throwaway Blinko instance with 2+ accounts (confirmed possible — Blinko supports multiple accounts/roles on one instance, including a superadmin role).
- Determine: do entries from different accounts pool into a shared/visible feed, or is each account's data private by default with only manual share links?
- Deliverable: a short findings doc + a recommendation for how "family journal" should actually be modeled (single shared account vs. multiple accounts + a shared feed vs. something else), since this affects Workstreams 3, 5, and 6.
- Branch: not applicable (research task, produces a doc, not code).

### Workstream 1 — Repo Fork & Deployment Pipeline
- Fork the repo, add upstream remote, verify local build works unmodified first.
- Write/validate the Dockerfile for our fork.
- Set up a GitHub Action: build on merge to `main`, push to `ghcr.io`.
- Write the docker-compose service definition for Unraid (env vars, volumes, network — coordinate with Workstream 7 on network topology).
- Wire up and test Pocket-ID OIDC login end-to-end; document/work around GitHub issue #1023 if it's hit.
- Branch: `infra/deploy-pipeline`

### Workstream 2 — Self-Hosted Whisper/ASR Service
- Deploy a self-hosted, OpenAI-API-compatible speech-to-text service (e.g. Whisper-WebUI or speaches/faster-whisper-server) as its own container.
- Configure GPU access, coordinating with existing Ollama GPU usage on the same host (capacity check — don't starve either service).
- Expose and document the `/v1/audio/transcriptions`-style endpoint for other workstreams to consume.
- Benchmark transcription latency and accuracy on a few representative voice-memo-length recordings.
- Branch: `infra/whisper-service`

### Workstream 3 — Voice-First Capture UX
**Depends on Workstream 2 (needs a working transcription endpoint). Informed by Workstream 0.**
- Point Blinko's native voice-record + "auto-convert to text" AI-provider config at the Workstream 2 endpoint. Test end-to-end: record → transcript appears on the note.
- Evaluate whether the native recording UX is prominent/simple enough to be the *default* landing action for a non-technical user. If not, build a plugin (toolbar icon + custom panel, using `window.Blinko.api` to create the note directly) that presents one big, obvious "record an entry" action as the primary interface.
- Deliverable: a non-technical person (ideally an actual test user) can open the app and successfully record an entry without instructions.
- Branch: `feature/voice-capture`

### Workstream 4 — AI Tagging, RAG Search & Location Logging
- Point Blinko's AI-provider config at the local Ollama instance for (a) embeddings used by RAG search and (b) the Scheduled AI Tasks auto-tagging job.
- Tune the auto-tagging prompt so tags are journal-appropriate (people, places, moods, occasions) rather than generic note-taking tags.
- Confirm the Scheduled Task cadence is acceptable — tags will appear on a cron schedule, not instantly; verify that's fine for this use case.
- Test location logging end-to-end from a mobile device.
- Verify RAG search returns relevant results for natural-language queries against real test entries.
- Branch: `config/ai-pipeline` (mostly configuration + prompt tuning, minimal code)

### Workstream 5 — UI Reskin: Theme & Copy
- Use Blinko's native theme settings (colors, gradients, backgrounds) to establish a warm, journal-appropriate visual identity — no fork needed for this part.
- Edit i18n locale strings to replace note-app vocabulary ("Blinkos," "Notes") with journal-appropriate language (pick a consistent voice — e.g. "Entries," "Moments" — and apply it everywhere). Check whether the plugin `i18n` hook can override locale strings without touching core; fall back to a small tracked diff in the fork only if it can't.
- Deliverable: screenshots/demo of the reskinned app for review before merging.
- Branch: `feature/ui-reskin`

### Workstream 6 — UI Declutter: Feature Restriction
- Identify nav items/features irrelevant to a family journal (RSS reader, music player, Telegram bot settings, plugin manager exposure for non-admin accounts, MCP server settings, etc.).
- Hide these primarily via a CSS-injecting plugin targeting stable selectors (preferred — no fork needed).
- Only fall back to direct, isolated, commented core-component edits where CSS alone can't fully hide something.
- Deliverable: a documented list of what was hidden and how (CSS plugin vs. fork patch), for future maintainability.
- Branch: `feature/ui-declutter`

### Workstream 7 — Network & Privacy Hardening
**Depends on Workstreams 1 & 2 having initial compose/container definitions to work with.**
- Place the Blinko, Whisper, and any AI-related containers on a Docker network with no default route to the public internet — only explicit access to required LAN endpoints (Ollama, Pocket-ID, reverse proxy).
- Audit actual network egress during normal use (e.g. packet capture during a test session) to verify no unexpected calls out (update checkers, crash reporters, etc.) — this is a from-scratch verification, not an assumption.
- Document the final firewall/network rules.
- Branch: `infra/network-hardening`

### Workstream 8 — Analytics View (stretch / lower priority)
- Requirement 9 ("high-level analysis: locations, moods, trends") is not natively covered by Blinko beyond AI-generated summary text.
- Build a small read-only view/plugin that queries existing tag/location data via the tRPC API and renders basic aggregate charts (tag frequency over time, entries-by-location, etc.).
- This is lower priority than Workstreams 0–7 — sequence it last, and treat it as optional if time-constrained.
- Branch: `feature/analytics-view`

## 7. Sequencing notes for the orchestrator

- **No file/system overlap, can start immediately in parallel:** Workstreams 0 (research), 1, 2, 5, 6.
- **Blocked:** Workstream 3 blocks on Workstream 2's endpoint existing. Workstream 7 blocks on Workstreams 1 & 2 producing initial container/compose definitions. Workstream 8 is lowest priority and can start anytime but should finish last.
- Workstream 0's findings should be checked before finalizing Workstreams 3, 5, and 6, since the family-sharing model affects how entries are surfaced across users.

## 8. Final integration & acceptance test (last, after 0–7 substantially done)

End-to-end scenario: a non-technical family member records a voice entry on their phone → a transcript appears on the entry automatically → tags and location are attached without manual action → the entry is visible in whatever shared/family view Workstream 0 determined is correct → the entry can later be found via a natural-language RAG search query.

Check the result against all 10 original requirements in §1 before calling this done.
