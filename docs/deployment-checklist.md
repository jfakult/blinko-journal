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
  boot (see its own doc comment) - it picks up `OLLAMA_BASE_URL` /
  `WHISPER_BASE_URL` from the compose file's `environment:` block directly
  (not secrets, safe to leave hardcoded there), no Ansible involvement needed
  for those.
