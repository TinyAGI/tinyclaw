# Deploy on VPS with Docker + Coolify

This guide sets up TinyClaw with:
- fixed container user (`PUID`/`PGID`)
- persistent CLI auth state (`~/.claude`, `~/.codex`, `~/.config`)
- persistent TinyClaw runtime data (`/app/.tinyclaw`)

## 1. Build Type in Coolify

Use **Dockerfile** deployment from your Git repo.

## 2. Build Args (fixed user)

Set build args in Coolify:

- `PUID=1000`
- `PGID=1000`

Use your host UID/GID if you want bind-mounted files owned by your VPS user.

## 3. Persistent Storage Mounts

Add these persistent mounts in Coolify:

- `/app/.tinyclaw`
- `/home/tinyclaw/tinyclaw-workspace`
- `/home/tinyclaw/.claude`
- `/home/tinyclaw/.codex`
- `/home/tinyclaw/.config`

Why:
- `/app/.tinyclaw`: settings, queues, logs, memory index/files
- workspace path: agent working dirs and per-agent sessions
- CLI dirs: keep Claude/Codex login state across container restarts/redeploys

## 4. First-time auth inside container

Open terminal in Coolify for the running container and do:

```bash
claude
# or, for token-based auth:
claude setup-token
```

If you use OpenAI/Codex provider too:

```bash
codex login
```

After login, state is preserved in mounted directories.

## 5. TinyClaw configuration

Create/edit `/app/.tinyclaw/settings.json` in the container (or mount and edit from host).

If not present, first start may enter setup flow. For production, keep settings.json in mounted storage so redeploys do not reset.

## 6. Health checks

Useful runtime checks in container terminal:

```bash
./tinyclaw.sh status
pgrep -af "queue-processor.js|telegram-client.js|heartbeat-cron.sh"
```

## 7. Notes

- The image excludes local `.tinyclaw`, `.env`, and `settings.json` via `.dockerignore` to avoid leaking local secrets into builds.
- If you change provider/model, restart container to ensure all long-running processes pick up updates cleanly.
