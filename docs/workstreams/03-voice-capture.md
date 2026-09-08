# Workstream 3 — Voice-First Capture UX

Branch: `feature/voice-capture`. Single-user journal (see [00-multi-user-model.md](00-multi-user-model.md)) — no sharing/account logic touched here. This is pure code/config work: nothing in this workstream was built or run (`bun`/`vite`), and no live recording/transcription was tested — that's deferred to whoever deploys this to the real server, per the task constraints.

## 1. What the native recording UX actually looks like today

The landing-screen recording entry point is `app/src/components/BlinkoAddButton/index.tsx`. Before this workstream's patch, it rendered a single circular floating action button (FAB), bottom-right, always visible:

- **Regular click/tap** → opens the note editor for a new text note (`ShowEditBlinkoModel('2xl', 'create')`).
- **Press and hold for 800ms** → also opens the editor, then 300ms later fires an `editor:startAudioRecording` event, which is caught by `UploadButtons` (`app/src/components/Common/Editor/Toolbar/UploadButtons/index.tsx`) and opens `AudioDialog` (`app/src/components/Common/AudioDialog/index.tsx`) — a polished full recording UI: live waveform, running timer, one tap to stop, one tap (green check) to attach and save, one tap (red X) to discard.

Once you're actually in the recording dialog, the flow is genuinely good — clear visual feedback, big touch targets, an obvious finish action. **The problem is entirely on the way in.**

### Honest assessment: the long-press gesture fails the "no instructions" bar

Workstream 3's own deliverable is: *"a non-technical person can open the app and successfully record an entry without instructions."* The 800ms long-press does not clear that bar:

- **Nothing on the button hints the gesture exists.** No label, no animated affordance, no onboarding tooltip. The button just looks like a standard "+" add button — a near-universal "create a new (text) item" symbol, which actively suggests the *wrong* action.
- **800ms is a long, deliberate hold.** It's long enough that a quick or hesitant tap (which is what most first-time users do) always lands on "create text note," never on recording. There is visual feedback (the button turns red and the icon becomes a voice icon) but only *after* you're already 800ms into holding it — i.e., the feedback confirms the gesture only once you've already stumbled into it, which doesn't help someone who never tried holding in the first place.
- **The `hugeicons:voice-id` icon-color change is a diagnostic, not a discovery aid.** It's useful once you're holding the button; it does nothing to tell a new user that holding is an option at all.
- **A secondary entry point exists but is also buried**: `UploadButtons` in the editor toolbar has its own microphone icon (`hugeicons:voice-id`) that opens the same `AudioDialog`. But this requires the note editor to *already be open* — so it's a second tap inside a screen the user had to already discover, not a landing-screen action.

Verdict: as a general note-taking app affordance, the long-press is a reasonable "power user shortcut." As *"the primary way entries get created"* for a non-technical single user (the actual brief requirement), it is not prominent or simple enough on its own.

## 2. Why a plugin can't fix this (and what actually can)

The task brief for this workstream, and the project brief generally, both frame the fix as: "if native isn't good enough, build a plugin with a big obvious toolbar icon using `window.Blinko.addToolBarIcon`." I built the plugin scaffolding conceptually before writing code and traced where `addToolBarIcon` (and every other additive plugin hook) actually renders, to check whether that would really solve the landing-screen problem. It doesn't, and the code makes that unambiguous:

```
app/src/store/plugin/pluginApiStore.tsx   -> customToolbarIcons, customCardFooterSlots,
                                              customEditorFooterSlots, customRightClickMenus, customAiPrompts
app/src/components/Common/Editor/index.tsx           -> consumes customToolbarIcons  (note editor toolbar only)
app/src/components/Common/Editor/index.tsx           -> consumes customEditorFooterSlots (note editor only)
app/src/components/BlinkoCard/index.tsx              -> consumes customCardFooterSlots (per-note card footer)
app/src/components/BlinkoRightClickMenu/index.tsx    -> consumes customRightClickMenus (context menu)
```

Every additive plugin surface Blinko exposes (`addToolBarIcon`, `addCardFooterSlot`, `addEditorFooterSlot`, `addRightClickMenu`, `addAiWritePrompt`) renders **inside a note that's already open, or inside a right-click context menu** — never on the landing/home screen itself. There is no documented or code-discoverable hook for adding a persistent button to the app's outer chrome. A plugin built with `addToolBarIcon` would add a *third* microphone icon, in the same editor toolbar that already has one (`UploadButtons`'s `hugeicons:voice-id` icon) — it would not be more discoverable than what's already there, because it lives behind the exact same "first, discover that you should open the editor" step that makes the current flow fail the brief's bar. Building it anyway, just to technically satisfy "build a plugin," would be a redundant no-op dressed up as a fix.

**Recommendation: a small, isolated core-file patch, not a plugin — for this one piece.** This is exactly the case the project brief anticipates: *"Prefer Blinko's plugin system over modifying core application files, everywhere the plugin API allows it. Where a core-file change is genuinely unavoidable, keep it minimal, isolated to as few files as possible, and mark it clearly (e.g. `// CUSTOM-JOURNAL:` comment)."* The plugin API genuinely does not reach the landing screen, so this is that case.

### What was changed

`app/src/components/BlinkoAddButton/index.tsx` — added a second, small, **always-visible** circular button directly above the existing "+" FAB: a plain red microphone icon (`solar:microphone-3-bold`), no gesture required, single tap calls the same `handleAudioRecording()` used by the long-press path (opens the editor and immediately triggers `AudioDialog`). The change is:

- Additive only — the original "+" button, its regular-click behavior, and its 800ms long-press shortcut are all left exactly as they were (no regression, no removed functionality, existing muscle memory / any user notes on the long-press still work).
- One file, isolated, tagged `// CUSTOM-JOURNAL:` with a comment explaining why it's here (referencing this doc) so it's trivially spottable during future upstream merges.
- Uses an icon (microphone in a circle) that's a near-universal "record audio" affordance (voice memo apps, WhatsApp, Slack) — the goal is that a first-time user needs zero instructions: two clearly different-colored buttons, "pencil-ish plus" for text vs. microphone for voice, both one tap, no hidden gestures.

This is the actual fix for the "non-technical person, no instructions" requirement. No `plugins/voice-capture/` package was built, since it would not have solved the stated problem — see above.

## 3. Config wiring: pointing native transcription at the self-hosted Whisper endpoint

Since the native recording → transcription pipeline (the `AudioDialog` → attach → auto-transcribe flow) is being kept and is genuinely solid, the remaining piece is pointing it at the Workstream 2 Whisper service instead of a cloud provider. This is an **admin-only, UI-driven config step** — no code change is needed or appropriate here (it's exactly the kind of thing the brief says should be admin-only config, not something baked into the fork).

### How the pipeline is wired (traced from code, for reference)

- Recording a note attachment: `note.upsert` (in `server/routerTrpc/note.ts`) checks `config.voiceModelId`. If set, and the note has audio attachments, it calls `AiService.processNoteAudioAttachments()` → `AiService.transcribeAudio()` (`server/aiServer/index.ts`), asynchronously, then appends the transcript to the note's content once done — no manual step.
- The actual model/provider resolution happens in `AiModelFactory.GetProvider()` (`server/aiServer/aiModelFactory.ts`): it reads `globalConfig.voiceModelId`, looks up that `aiModels` row (which has a `provider` relation with `baseURL`/`apiKey`/`provider` type), and builds an OpenAI-compatible client via `AudioProvider` (`server/aiServer/providers/AudioProvider.ts`) pointed at `provider.baseURL`, using `MastraVoice`/`OpenAIVoice.listeningClient` under the hood — which is exactly the standard `/v1/audio/transcriptions` multipart contract.
- The config key that matters is **`voiceModelId`** (not the similarly-named `audioModelId`, which exists in the config schema but isn't read anywhere in this pipeline as of this branch — don't set that one expecting it to do anything).

### Steps for the admin (do this in the running app, once Workstream 2's Whisper container is up on the `whisper:8000` Docker-network hostname)

1. **Settings → AI → AI Providers → Add Provider.**
   - Choose the **Custom** template (not the OpenAI preset — the preset points at `api.openai.com` and can't have its base URL edited the same way).
   - `Base URL`: `http://whisper:8000/v1`
   - `API Key`: any non-empty placeholder string (e.g. `local-whisper`). The OpenAI SDK client Blinko uses requires a truthy API key even though the self-hosted Whisper service itself doesn't check it — see `server/aiServer/providers/AudioProvider.ts`, the `custom` branch only builds a client `if (config.apiKey)`.
   - Save the provider.

2. **On that provider, Add Model.**
   - `Model Key`: whatever model name the Workstream 2 Whisper service expects/reports (check `infra-whisper-service`'s docs — typically something like `whisper-1` or the underlying model name, e.g. `Systran/faster-whisper-base`). If unsure, `whisper-1` is a safe first try since most OpenAI-compatible Whisper servers accept it as an alias regardless of the model actually loaded.
   - Under **Capabilities**, check **Audio**. This is required — `ModelDialogContent.tsx` won't let you save a model with no capability selected, and `transcribeAudio()` explicitly checks `(voiceModel.capabilities as any)?.audio` before proceeding.
   - Optionally use the "Test capabilities" action in the provider/model card (`ProviderCard.tsx` / `ModelDialogContent.tsx` both check `result.capabilities.audio.success`) to confirm the endpoint responds correctly before relying on it.
   - Save the model.

3. **Settings → AI → Default Models Configuration → Voice Model.**
   - Select the model you just created. This writes `config.voiceModelId` via `api.config.update.mutate({ key: 'voiceModelId', ... })` (`DefaultModelsSection.tsx`), which is the exact field the transcription pipeline reads.

No code or seed changes are required for this — it's all runtime config through the admin UI, stored in the existing `aiProviders`/`aiModels`/config tables. If a future workstream wants this pre-seeded at deploy time instead of clicked through once by hand, the natural place is `prisma/seed.ts` (not touched in this workstream, since it's a one-time admin action and the brief scopes "settings/config" work to the instance admin, not to code).

## 4. Recommendation summary

- **Native transcription pipeline: keep, just point it at `whisper:8000`** via the admin AI settings (§3). It's solid — async, no manual step, appends directly to the note.
- **Native landing-screen recording UX: not good enough as-is** — the long-press gesture is undiscoverable for a non-technical user with zero instructions.
- **Fix implemented: a second, always-visible, single-tap record button** on the landing screen (`app/src/components/BlinkoAddButton/index.tsx`), added as a minimal, isolated, `// CUSTOM-JOURNAL:`-tagged core patch — because the plugin API's additive hooks (`addToolBarIcon` etc.) only reach inside an already-open note editor / card / context menu, never the landing screen, so a plugin genuinely could not have delivered "a big, obvious record action as the primary interface" the way this workstream's goal requires.
- **No `plugins/voice-capture/` package was built.** Building one would have added a third, equally-buried microphone icon inside the editor toolbar rather than solving the actual discoverability gap — not a good use of the "minimum long-term maintenance" principle in the brief (an extra plugin package to maintain, for no real UX gain over what `UploadButtons` already provides in that same spot).

## 5. Files touched by this workstream

- `app/src/components/BlinkoAddButton/index.tsx` — added the always-visible record button (`// CUSTOM-JOURNAL:` tagged, additive only).
- `docs/workstreams/03-voice-capture.md` — this document.
