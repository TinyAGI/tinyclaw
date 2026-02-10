#!/bin/bash
# Heartbeat - Periodically prompts active provider via queue system

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEARTBEAT_FILE="$SCRIPT_DIR/.tinyclaw/heartbeat.md"
LOG_FILE="$SCRIPT_DIR/.tinyclaw/logs/heartbeat.log"
QUEUE_INCOMING="$SCRIPT_DIR/.tinyclaw/queue/incoming"
SETTINGS_FILE="$SCRIPT_DIR/.tinyclaw/settings.json"

# Read interval from settings.json, default to 500
if [ -f "$SETTINGS_FILE" ]; then
    INTERVAL=$(grep -o '"heartbeat_interval"[[:space:]]*:[[:space:]]*[0-9]*' "$SETTINGS_FILE" | grep -o '[0-9]*$')
fi
INTERVAL=${INTERVAL:-500}

mkdir -p "$QUEUE_INCOMING"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "Heartbeat started (interval: ${INTERVAL}s)"

while true; do
    sleep "$INTERVAL"

    log "Heartbeat check..."

    # Read heartbeat prompt
    if [ -f "$HEARTBEAT_FILE" ]; then
        PROMPT=$(cat "$HEARTBEAT_FILE")
    else
        PROMPT="Quick status check: Any pending tasks? Keep response brief."
    fi

    # Generate unique message ID
    MESSAGE_ID="heartbeat_$(date +%s)_$$"

    # Write to queue (like any other channel)
    cat > "$QUEUE_INCOMING/${MESSAGE_ID}.json" << EOF
{
  "channel": "heartbeat",
  "sender": "System",
  "senderId": "heartbeat",
  "message": "$PROMPT",
  "timestamp": $(date +%s)000,
  "messageId": "$MESSAGE_ID"
}
EOF

    log "✓ Heartbeat queued: $MESSAGE_ID"

    # Optional: wait a bit and check if response was created
    sleep 10

    # Check for response (optional logging)
    RESPONSE_FILE="$SCRIPT_DIR/.tinyclaw/queue/outgoing/${MESSAGE_ID}.json"
    if [ -f "$RESPONSE_FILE" ]; then
        RESPONSE=$(cat "$RESPONSE_FILE" | jq -r '.message' 2>/dev/null || echo "")
        if [ -n "$RESPONSE" ]; then
            log "Response: ${RESPONSE:0:100}..."
            # Clean up response file (we don't need to send it anywhere)
            rm "$RESPONSE_FILE"
        fi
    fi
done
