#!/usr/bin/env bash
# Heartbeat - Periodically prompts all agents via the API server

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
if [ -z "$TINYCLAW_HOME" ]; then
    if [ -f "$PROJECT_ROOT/.tinyclaw/settings.json" ]; then
        TINYCLAW_HOME="$PROJECT_ROOT/.tinyclaw"
    else
        TINYCLAW_HOME="$HOME/.tinyclaw"
    fi
fi
LOG_FILE="$TINYCLAW_HOME/logs/heartbeat.log"
SETTINGS_FILE="$TINYCLAW_HOME/settings.json"
API_PORT="${TINYCLAW_API_PORT:-3777}"
API_URL="http://localhost:${API_PORT}"

# Read interval from settings.json, default to 3600
if [ -f "$SETTINGS_FILE" ]; then
    if command -v jq &> /dev/null; then
        INTERVAL=$(jq -r '.monitoring.heartbeat_interval // empty' "$SETTINGS_FILE" 2>/dev/null)
    fi
fi
INTERVAL=${INTERVAL:-3600}

mkdir -p "$(dirname "$LOG_FILE")"

rotate_log_file() {
    local file="$1"
    local max_bytes=$((10 * 1024 * 1024))
    local max_files=5

    [ -f "$file" ] || return 0

    local size
    size=$(wc -c < "$file" | tr -d ' ')
    if [ "$size" -lt "$max_bytes" ]; then
        return 0
    fi

    local ext="${file##*.}"
    local base="${file%.*}"
    local i
    for ((i=max_files; i>=1; i--)); do
        local current="${base}.${i}.${ext}"
        local previous
        if [ "$i" -eq 1 ]; then
            previous="$file"
        else
            previous="${base}.$((i-1)).${ext}"
        fi

        [ -f "$previous" ] || continue
        [ ! -f "$current" ] || rm -f "$current"
        mv "$previous" "$current"
    done
}

log() {
    local msg="$*"
    local timestamp
    timestamp=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $msg"
    rotate_log_file "$LOG_FILE"
    if command -v jq >/dev/null 2>&1; then
        jq -nc \
            --arg time "$timestamp" \
            --arg level "info" \
            --arg source "heartbeat" \
            --arg component "heartbeat" \
            --arg msg "$msg" \
            '{time:$time,level:$level,source:$source,component:$component,msg:$msg}' >> "$LOG_FILE"
    else
        node -e 'const [time, level, source, component, msg] = process.argv.slice(1); console.log(JSON.stringify({ time, level, source, component, msg }));' \
            "$timestamp" "info" "heartbeat" "heartbeat" "$msg" >> "$LOG_FILE"
    fi
    printf '\n' >> "$LOG_FILE"
}

log "Heartbeat started (interval: ${INTERVAL}s, API: ${API_URL})"

while true; do
    sleep "$INTERVAL"

    log "Heartbeat check - scanning all agents..."

    # Get all agents from settings
    if [ ! -f "$SETTINGS_FILE" ]; then
        log "WARNING: No settings file found, skipping heartbeat"
        continue
    fi

    # Get workspace path
    WORKSPACE_PATH=$(jq -r '.workspace.path // empty' "$SETTINGS_FILE" 2>/dev/null)
    if [ -z "$WORKSPACE_PATH" ]; then
        WORKSPACE_PATH="$HOME/tinyclaw-workspace"
    fi

    # Get all agent IDs
    AGENT_IDS=$(jq -r '(.agents // {}) | keys[]' "$SETTINGS_FILE" 2>/dev/null)

    if [ -z "$AGENT_IDS" ]; then
        log "No agents configured - using default agent"
        AGENT_IDS="default"
    fi

    AGENT_COUNT=0

    # Send heartbeat to each agent
    for AGENT_ID in $AGENT_IDS; do
        AGENT_COUNT=$((AGENT_COUNT + 1))

        # Get agent's working directory
        AGENT_DIR=$(jq -r "(.agents // {}).\"${AGENT_ID}\".working_directory // empty" "$SETTINGS_FILE" 2>/dev/null)
        if [ -z "$AGENT_DIR" ]; then
            AGENT_DIR="$WORKSPACE_PATH/$AGENT_ID"
        fi

        # Read agent-specific heartbeat.md
        HEARTBEAT_FILE="$AGENT_DIR/heartbeat.md"
        if [ -f "$HEARTBEAT_FILE" ]; then
            PROMPT=$(cat "$HEARTBEAT_FILE")
            log "  → Agent @$AGENT_ID: using custom heartbeat.md"
        else
            PROMPT="Quick status check: Any pending tasks? Keep response brief."
            log "  → Agent @$AGENT_ID: using default prompt"
        fi

        # Enqueue via API server
        RESPONSE=$(curl -s -X POST "${API_URL}/api/message" \
            -H "Content-Type: application/json" \
            -d "$(jq -n \
                --arg message "$PROMPT" \
                --arg agent "$AGENT_ID" \
                --arg channel "heartbeat" \
                --arg sender "System" \
                '{message: $message, agent: $agent, channel: $channel, sender: $sender}'
            )" 2>&1)

        if echo "$RESPONSE" | jq -e '.ok' &>/dev/null; then
            MESSAGE_ID=$(echo "$RESPONSE" | jq -r '.messageId')
            log "  ✓ Queued for @$AGENT_ID: $MESSAGE_ID"
        else
            log "  ✗ Failed to queue for @$AGENT_ID: $RESPONSE"
        fi
    done

    log "Heartbeat sent to $AGENT_COUNT agent(s)"

    # Optional: wait and log responses
    sleep 10

    # Check recent responses for heartbeat messages
    RESPONSES=$(curl -s "${API_URL}/api/responses?limit=20" 2>&1)
    if echo "$RESPONSES" | jq -e '.' &>/dev/null; then
        for AGENT_ID in $AGENT_IDS; do
            RESP=$(echo "$RESPONSES" | jq -r \
                --arg ch "heartbeat" \
                '.[] | select(.channel == $ch) | .message' 2>/dev/null | head -1)
            if [ -n "$RESP" ]; then
                log "  ← @$AGENT_ID: ${RESP:0:80}..."
            fi
        done
    fi
done
