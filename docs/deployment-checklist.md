# Deployment checklist (Ansible)

The remote server builds/deploys this fork via Ansible (not something in this
repo - the playbook lives elsewhere). This doc exists so whoever
builds/maintains that playbook has an unambiguous list of what the app
actually needs provisioned, without having to reverse-engineer it from
`docker-compose.prod.yml`.

## 1. `.env` file

`docker-compose.prod.yml` reads `${NEXTAUTH_SECRET}` and `${DATABASE_URL}` via
docker compose's variable substitution, sourced from a `.env` file in the same
directory as the compose file on the deploy host. See `.env.prod.tmpl` for the
exact keys expected.

**Ansible needs to**: render/copy a `.env` file into place before `docker
compose up`, containing:
- `NEXTAUTH_SECRET` - a real secret (`openssl rand -base64 32`), not the local
  dev placeholder.
- `DATABASE_URL` - a real connection string for the external Postgres at
  `192.168.1.203:5432`, with the actual username/password (not
  `mysecretpassword`, the placeholder still sitting in `.env.prod.tmpl`).
- `OLLAMA_BASE_URL` / `OLLAMA_CHAT_MODEL` / `OLLAMA_EMBEDDING_MODEL` /
  `OLLAMA_VISION_MODEL` / `WHISPER_BASE_URL` (only once the whisper service
  below is actually deployed) / `WHISPER_MODEL` - not secrets, but templating
  them through the same `.env` mechanism means swapping a model is an Ansible
  var change + a redeploy, not a hand-edit of a committed compose file. See
  `.env.prod.tmpl` for current defaults and `docs/workstreams/04-ai-pipeline.md`.

Likely approach: an Ansible Vault-encrypted var file + a `template:` task
rendering `.env` from `.env.prod.tmpl`'s structure, or a `copy:`/`lineinfile:`
task if the values are managed as plain Ansible vars/secrets elsewhere. Either
way, **`.env` should never be committed to this git repo** - it's already
gitignored here specifically so it can only exist on the actual deploy host.

## 2. Persistent volume for `.blinko/`

`docker-compose.prod.yml` bind-mounts `~/blinko-journal/.blinko:/app/.blinko`
- this holds uploaded attachments, voice memos, cover/background images, and
any manually-installed plugins (see `journal-declutter` in `plugins/`, which
currently has to be installed by hand - files + a `plugin` DB row - since the
official GitHub-Releases-based install flow isn't set up for this fork yet).

**Ansible needs to**: ensure `~/blinko-journal/.blinko` (or wherever the bind
mount path is adjusted to point) exists with correct ownership/permissions
*before* the container starts, so Docker doesn't auto-create it with the
wrong owner. Consider whether this path should also be included in whatever
backup strategy exists for the Unraid host - it's the only copy of
attachments/voice memos outside the database.

## 3. What's already handled without Ansible involvement

- Postgres itself: external, already running at `192.168.1.203:5432`,
  presumably durable on its own infra - not something this app's deployment
  needs to provision.
- The AI config seed (`prisma/seed.ts`) is self-healing on every container
  boot (see its own doc comment) - it reads the `OLLAMA_*`/`WHISPER_*` env
  vars (see §1) and creates/repairs the corresponding provider/model/config
  rows itself; no Ansible involvement needed beyond getting those vars into
  `.env`.

## 4. AI infra: Whisper service + network overlay

Two additional compose files, both meant to be applied as overlays on top of
`docker-compose.prod.yml` (not deployed alone):

- `docker-compose.whisper.yml` - the self-hosted speech-to-text container
  (voice memo transcription). Requires an NVIDIA GPU + driver on the deploy
  host reachable by Docker (`--gpus`/`nvidia-container-toolkit`), and shares
  that GPU with the host's existing Ollama instance - see
  `docs/workstreams/02-whisper-service.md` for the capacity-check steps that
  need to happen on the real box before trusting the GPU reservation numbers
  in that file.
- `docker-compose.network.yml` - the network segmentation overlay
  (`blinko-internal` internal-only network for blinko-website/postgres/whisper,
  `blinko-egress` for blinko-website's outbound calls to Ollama/Pocket-ID).
  **Required**, not optional, once whisper is deployed - `docker-compose.whisper.yml`
  no longer declares its own network and depends entirely on this overlay to
  attach `whisper` to the same network as `blinko-website` (Docker DNS name
  `whisper:8000`). See `docs/workstreams/07-network-hardening.md` for the full
  topology and the host-firewall egress-allowlist rules (`DOCKER-USER` iptables
  chain) that overlay alone does not enforce.

**Ansible needs to**: bring the stack up with all three files together once
Whisper is ready to deploy:
```
docker compose -f docker-compose.prod.yml -f docker-compose.whisper.yml -f docker-compose.network.yml up -d
```
and apply the host firewall rules from `docs/workstreams/07-network-hardening.md`
§3 (not something compose itself can do).
