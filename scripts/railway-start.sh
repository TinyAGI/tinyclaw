#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SETTINGS_FILE="$PROJECT_ROOT/.tinyclaw/settings.json"

cd "$PROJECT_ROOT"
export PATH="$PROJECT_ROOT/node_modules/.bin:$PATH"

if command -v npm >/dev/null 2>&1; then
    NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
    if [ -n "$NPM_PREFIX" ] && [ -d "$NPM_PREFIX/bin" ]; then
        export PATH="$NPM_PREFIX/bin:$PATH"
    fi
fi

node "$PROJECT_ROOT/scripts/railway-bootstrap-settings.mjs"

if [ ! -d "$PROJECT_ROOT/dist" ]; then
    npm run build
fi

if [ ! -f "$SETTINGS_FILE" ]; then
    echo "[railway] settings file missing at $SETTINGS_FILE"
    exit 1
fi

mapfile -t ACTIVE_CHANNELS < <(node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));for(const c of (s.channels?.enabled||[])) console.log(c);" "$SETTINGS_FILE")

if [ "${#ACTIVE_CHANNELS[@]}" -eq 0 ]; then
    echo "[railway] no channels enabled in settings"
    exit 1
fi

mapfile -t PROVIDERS < <(node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const set=new Set();for(const a of Object.values(s.agents||{})){if(a&&a.provider)set.add(String(a.provider).toLowerCase())}for(const p of set) console.log(p);" "$SETTINGS_FILE")

for provider in "${PROVIDERS[@]}"; do
    case "$provider" in
        openai)
            if ! command -v codex >/dev/null 2>&1; then
                echo "[railway] provider 'openai' requires 'codex' CLI in PATH"
                echo "[railway] install with: npm install -g @openai/codex"
                exit 1
            fi
            ;;
        anthropic)
            if ! command -v claude >/dev/null 2>&1; then
                echo "[railway] provider 'anthropic' requires 'claude' CLI in PATH"
                exit 1
            fi
            ;;
    esac
done

PIDS=()

start_proc() {
    local name="$1"
    shift
    echo "[railway] starting ${name}: $*"
    "$@" &
    local pid=$!
    PIDS+=("$pid")
    echo "[railway] started ${name} (pid=$pid)"
}

for ch in "${ACTIVE_CHANNELS[@]}"; do
    case "$ch" in
        telegram)
            start_proc "telegram" node "$PROJECT_ROOT/dist/channels/telegram-client.js"
            ;;
        discord)
            start_proc "discord" node "$PROJECT_ROOT/dist/channels/discord-client.js"
            ;;
        whatsapp)
            start_proc "whatsapp" node "$PROJECT_ROOT/dist/channels/whatsapp-client.js"
            ;;
        *)
            echo "[railway] unsupported channel '${ch}' in settings, skipping"
            ;;
    esac
done

start_proc "queue" node "$PROJECT_ROOT/dist/queue-processor.js"

if [ "${TINYCLAW_ENABLE_HEARTBEAT:-false}" = "true" ]; then
    start_proc "heartbeat" bash "$PROJECT_ROOT/lib/heartbeat-cron.sh"
fi

cleanup() {
    echo "[railway] shutting down..."
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
}

trap cleanup SIGINT SIGTERM

set +e
wait -n
exit_code=$?
set -e

echo "[railway] one process exited (code=$exit_code), stopping all..."
cleanup
wait || true
exit "$exit_code"
