# Railway Deploy (No UI Setup Wizard)

TinyClaw can run on Railway without the interactive `tinyclaw setup` wizard.

This repo includes:

- `railway.json` for build/deploy commands
- `scripts/railway-bootstrap-settings.mjs` to generate `.tinyclaw/settings.json` from environment variables
- `scripts/railway-start.sh` to run channel workers + queue processor

## 1. Create a Railway project from this repo

Railway will detect `railway.json` automatically.

## 2. Add environment variables

At minimum (Telegram + OpenAI/Codex):

- `TINYCLAW_CHANNELS=telegram`
- `TELEGRAM_BOT_TOKEN=...`
- `TINYCLAW_PROVIDER=openai`
- `TINYCLAW_MODEL=gpt-5.3-codex`
- `OPENAI_API_KEY=...`

Optional:

- `TINYCLAW_OPENAI_BASE_URL=https://openrouter.ai/api/v1`
- `TINYCLAW_WORKSPACE_PATH=/app/tinyclaw-workspace`
- `TINYCLAW_DEFAULT_AGENT_ID=assistant`
- `TINYCLAW_DEFAULT_AGENT_NAME=Assistant`
- `TINYCLAW_HEARTBEAT_INTERVAL=3600`
- `TINYCLAW_ENABLE_HEARTBEAT=true`
- `DISCORD_BOT_TOKEN=...` (if `discord` channel enabled)

## 3. Advanced config (full JSON)

If you want full control over agents/teams/channels, set one variable:

- `TINYCLAW_SETTINGS_JSON` (raw JSON string), or
- `TINYCLAW_SETTINGS_B64` (base64-encoded JSON)

When present, these override the simple env-based generator.

## 4. How config works at runtime

On startup:

1. `scripts/railway-bootstrap-settings.mjs` writes `.tinyclaw/settings.json`
2. `scripts/railway-start.sh` starts:
   - enabled channel clients
   - `dist/queue-processor.js`
   - optional heartbeat worker

## Notes

- OpenAI provider requires `codex` CLI; `railway.json` installs `@openai/codex` during build.
- Anthropic provider requires `claude` CLI, which is not installed by default in this template.
- WhatsApp is technically supported but usually not ideal for headless cloud deploys due QR/device linking.
