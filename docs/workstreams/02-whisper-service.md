# Workstream 2 — Self-Hosted Whisper/ASR Service

**Status: config written, not deployed.** This branch is pure code/config — no
docker was run, no container was started, nothing was benchmarked. See
"Deferred to deploy time" at the end for what still needs to happen on the
real server.

## What was picked, and why

**[speaches](https://github.com/speaches-ai/speaches)** (MIT license), image
`ghcr.io/speaches-ai/speaches:latest-cuda-12.6.3`.

- Formerly published as `faster-whisper-server` (`fedirz/faster-whisper-server`
  on Docker Hub) — same project, renamed after TTS (Piper/Kokoro) support was
  added. Actively maintained: regular tagged releases, a v0.9.0 release-candidate
  series in flight as of this writing, 700+ commits.
- Wraps [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)
  (a CTranslate2 reimplementation of OpenAI's Whisper, several times faster
  than the reference implementation on the same hardware) behind a FastAPI
  server.
- Its `/v1/audio/transcriptions` route is a genuine OpenAI-API-compatible
  endpoint — same request shape (multipart form: `file`, `model`,
  `response_format`, `language`, `temperature`, ...), same response shapes
  (`json`/`verbose_json`/`text`/`srt`/`vtt`). It's built specifically so that
  "all tools and SDKs that work with OpenAI's API should work with speaches."
- Ships first-class CUDA docker images and compose files
  (`compose.cuda.yaml` in their repo), which is what
  `docker-compose.whisper.yml` in this repo is adapted from.

Alternatives considered and rejected:
- **Whisper-WebUI** (mentioned in the brief as an option) — primarily a
  Gradio UI for one-off transcription jobs, not designed first as a
  long-running OpenAI-compatible API server. Would need more adaptation to
  get a clean `/v1/audio/transcriptions` contract out of it.
- **openedai-whisper** (`matatonic/openedai-whisper`) — also OpenAI-compatible
  and viable, but smaller community/less active than speaches; speaches was
  chosen as the more actively maintained option with the more complete
  OpenAI-surface coverage (it explicitly targets being "Ollama, but for
  TTS/STT," which fits this project's "point every AI feature at a local
  service" pattern well).

## Why Blinko needs it to be OpenAI-compatible specifically

Confirmed by reading the actual code path, not just the brief:

- `server/aiServer/providers/AudioProvider.ts` — for any provider other than
  `openai`/`azure`/`azureopenai` (i.e. the `custom` branch, which is what a
  self-hosted endpoint uses), Blinko builds an `OpenAIVoice` from
  `@mastra/voice-openai` and explicitly overrides its `listeningClient` with:
  ```ts
  openAIVoice.listeningClient = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    fetch: this.proxiedFetch,
  });
  ```
  That's the stock `openai` npm SDK. Its `audio.transcriptions.create()` call
  POSTs to `${baseURL}/audio/transcriptions` — there is no Blinko-specific
  transcription protocol to satisfy, it's literally the OpenAI SDK talking to
  whatever `baseURL` is configured.
- `server/aiServer/aiModelFactory.ts` builds that `AudioConfig` from an
  `AiProviders` row (`provider.baseURL`, `provider.apiKey`) joined with an
  `AiModels` row that has `capabilities.audio = true` and a `modelKey`, and
  `globalConfig.voiceModelId` selects which `AiModels` row is "the" voice
  model.
- `server/aiServer/index.ts` (`AiServer.transcribeAudio`) reads the note's
  audio attachment off disk and calls `audioModel.listen(audioStream, {
  filetype: ... })`, which is what ultimately triggers the HTTP call above.

So: this container just needs to *be* a correct OpenAI-compatible ASR
endpoint at some `baseURL`; nothing else on the Blinko side needs to change
for the transport to work.

## The `/v1/audio/transcriptions` contract (for Workstream 3)

**Base URL to configure in Blinko:** `http://whisper:8000/v1`
(container-to-container, on `blinko-network` — see the network caveat below).
The OpenAI SDK appends `/audio/transcriptions` itself, so the actual request
lands at `http://whisper:8000/v1/audio/transcriptions`.

**Request:** `multipart/form-data` POST.

| field | required | notes |
|---|---|---|
| `file` | yes | the audio file (Blinko already writes a `ReadStream` of the note's audio attachment here — see `AiServer.transcribeAudio`) |
| `model` | yes | a model id speaches has (or can pull) — set this to whatever `modelKey` is on the `AiModels` row in Blinko, e.g. `Systran/faster-whisper-medium` (see `docker-compose.whisper.yml` for the model-choice rationale) |
| `language` | no | ISO-639-1 code; omit for auto-detect |
| `response_format` | no | `json` (default), `text`, `srt`, `vtt`, `verbose_json` — Blinko/mastra's default path expects plain text back, so leave this as `json`/default unless something downstream needs otherwise |
| `temperature` | no | sampling temperature, default 0 |

Example, for manual verification once the container is actually running
(not run as part of this workstream):
```bash
curl -s http://whisper:8000/v1/audio/transcriptions \
  -F "file=@sample.wav" \
  -F "model=Systran/faster-whisper-medium"
```

**Response** (`response_format=json`, the default):
```json
{
  "text": "this is the transcribed text of the voice memo"
}
```

**Response** (`response_format=verbose_json`) — OpenAI's fuller shape,
supported if anything ever needs segment-level timing/confidence:
```json
{
  "task": "transcribe",
  "language": "en",
  "duration": 12.34,
  "text": "this is the transcribed text of the voice memo",
  "segments": [
    {
      "id": 0,
      "seek": 0,
      "start": 0.0,
      "end": 3.2,
      "text": "this is the transcribed",
      "tokens": [50364, ...],
      "temperature": 0.0,
      "avg_logprob": -0.18,
      "compression_ratio": 1.24,
      "no_speech_prob": 0.01
    }
  ]
}
```

**Health check:** `GET /health` (used by the compose healthcheck).

**Blinko-side setup this implies for Workstream 3** (AI provider config UI,
admin-only per the brief):
1. Create an `AiProviders` row: provider type `custom`, `baseURL =
   http://whisper:8000/v1`. The OpenAI SDK requires a non-empty `apiKey`
   string to construct the client even though speaches doesn't enforce auth
   by default (see `docker-compose.whisper.yml`'s `API_KEY` note) — any
   placeholder value works unless `API_KEY` is later set on the speaches
   container to match.
2. Create an `AiModels` row under that provider with `modelKey =
   Systran/faster-whisper-medium` (must match a model speaches actually has
   pulled/can pull) and `capabilities.audio = true`.
3. Set that model as `globalConfig.voiceModelId`.
4. Note the UI itself has an "audio cannot test" guard
   (`server/routerTrpc/ai.ts`) — the built-in "test connection" button
   doesn't support audio models, so the only real verification is recording
   an actual voice note end-to-end.

## GPU coordination caveat

The Unraid host already runs Ollama on its one GPU. This branch does **not**
know Ollama's actual VRAM footprint or whether it can coexist with a Whisper
model loaded concurrently — that requires being on the real box. Everything
GPU-related in `docker-compose.whisper.yml` is written and clearly commented
as an unverified starting point, specifically:
- `deploy.resources.reservations.devices` uses `count: 1` (not `all`) as a
  conservative guess, not a validated number.
- `STT_MODEL_TTL: 300` unloads the Whisper model from GPU memory after 5
  minutes idle, so it isn't permanently resident competing with Ollama
  between journal entries — this trades a few seconds of reload latency on
  the next transcription after an idle gap for lower steady-state VRAM
  pressure, which fits a personal journal's bursty usage.
- The model default (`Systran/faster-whisper-medium`) was chosen partly
  *because* it has a modest VRAM footprint (~1.5GB at float16) relative to
  large-v3/large-v3-turbo, to leave more headroom for Ollama by default.

Before trusting any of this on the real server: check `nvidia-smi` for free
VRAM with Ollama's normal model already loaded, confirm faster-whisper-medium's
actual footprint on that GPU, and adjust the reservation/model size/TTL
accordingly. Do not treat the numbers in this branch as validated.

## Network caveat (for Workstream 1 / 7)

`docker-compose.whisper.yml` attaches to an `external: true` network named
`blinko-network`, matching the network Blinko's own compose file declares, so
`whisper:8000` resolves by Docker DNS from the `blinko-website` container.
However, as of this writing `docker-compose.prod.yml` declares
`blinko-network` with `driver: host` and has the `networks:` block on
`blinko-website` itself commented out. Docker DNS/service-name resolution
doesn't exist under host-network mode — there's no bridge for `whisper` to be
resolvable on. For the `whisper:8000` address this doc and Workstream 3
depend on to actually work, `docker-compose.prod.yml` needs to move to a
normal bridge network (the compose default; drop `driver: host`) with both
`blinko-website` and this `whisper` service actually attached to
`blinko-network`. Not fixed here since `docker-compose.prod.yml` isn't this
workstream's file to own — flagging for whoever finalizes it.

## Benchmarking — explicitly deferred, not done here

Per this workstream's constraints, no docker was run and nothing was
benchmarked from this branch. Once the service is actually deployed on the
Unraid server, whoever does that should still check:

1. **Latency** on a handful of representative voice-memo-length recordings
   (say, 10s / 60s / 3min clips) — cold (first request after idle unload)
   and warm (model already resident) timings, since `STT_MODEL_TTL` makes
   cold-start latency a real, recurring cost here, not a one-time thing.
2. **Accuracy**, spot-checked against the same clips manually transcribed,
   especially for names/places (the kind of thing a journal-tagging pipeline
   downstream cares about getting right) — and whether `faster-whisper-medium`
   is good enough or the large-v3-turbo upgrade path (noted in
   `docker-compose.whisper.yml`) is worth the extra VRAM.
3. **GPU contention** — transcribe while Ollama is mid-generation (e.g.
   during a Scheduled AI Task tagging run) and confirm neither service stalls
   or OOMs the other.
4. **Concurrent VRAM residency** — confirm `nvidia-smi` shows both models
   coexisting within actual free VRAM once the capacity check above is done,
   not just that individual requests succeed serially.
