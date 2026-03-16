#!/usr/bin/env bash
# schedule.sh — Create, list, and delete scheduled tasks via the tinyclaw API.
#
# Usage:
#   schedule.sh create  --cron "EXPR" --agent AGENT_ID --message "MSG" [--channel CH] [--sender S] [--label LABEL]
#   schedule.sh list    [--agent AGENT_ID]
#   schedule.sh delete  --label LABEL
#   schedule.sh delete  --all
#
# Requires: curl, grep, sed (standard POSIX tools). No python3/jq needed.

set -euo pipefail

API_PORT="${TINYCLAW_API_PORT:-3777}"
API_BASE="http://localhost:${API_PORT}"

# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────

usage() {
    cat <<'USAGE'
schedule.sh — manage tinyclaw scheduled tasks via the API

Commands:
  create   Create a new schedule
  list     List existing schedules
  delete   Delete a schedule by label (or --all)

Create flags:
  --cron "EXPR"       Cron expression (required, 5-field)
  --agent AGENT_ID    Target agent (required)
  --message "MSG"     Message / task context to send (required)
  --channel CH        Channel name (default: schedule)
  --sender S          Sender name (default: Scheduler)
  --label LABEL       Unique label for this schedule (default: auto-generated)

List flags:
  --agent AGENT_ID    Filter by agent (optional)

Delete flags:
  --label LABEL       Delete the schedule with this label
  --all               Delete ALL tinyclaw schedules

Examples:
  schedule.sh create --cron "0 9 * * *" --agent coder --message "Run daily tests"
  schedule.sh create --cron "*/30 * * * *" --agent analyst --message "Check metrics" --label metrics-check
  schedule.sh list
  schedule.sh list --agent coder
  schedule.sh delete --label metrics-check
  schedule.sh delete --all
USAGE
    exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

# Escape a string for safe embedding in JSON (handles \, ", newlines, tabs)
json_escape() {
    local s="$1"
    s="${s//\\/\\\\}"      # backslash
    s="${s//\"/\\\"}"      # double quote
    s="${s//$'\n'/\\n}"    # newline
    s="${s//$'\t'/\\t}"    # tab
    printf '%s' "$s"
}

# Extract a simple string value from JSON by key (basic grep, no parser needed)
# Usage: json_val '{"ok":true,"label":"foo"}' "label"  →  foo
json_val() {
    local json="$1" key="$2"
    echo "$json" | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed "s/\"${key}\"[[:space:]]*:[[:space:]]*\"//" | sed 's/"$//'
}

# Check if JSON contains "ok":true
json_ok() {
    echo "$1" | grep -q '"ok"[[:space:]]*:[[:space:]]*true'
}

# ────────────────────────────────────────────
# Commands
# ────────────────────────────────────────────

cmd_create() {
    local cron_expr="" agent="" message="" channel="schedule" sender="Scheduler" label=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --cron)    cron_expr="$2"; shift 2 ;;
            --agent)   agent="$2"; shift 2 ;;
            --message) message="$2"; shift 2 ;;
            --channel) channel="$2"; shift 2 ;;
            --sender)  sender="$2"; shift 2 ;;
            --label)   label="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    [[ -z "$cron_expr" ]] && die "--cron is required"
    [[ -z "$agent" ]]     && die "--agent is required"
    [[ -z "$message" ]]   && die "--message is required"

    # Validate cron expression has 5 fields
    local field_count
    field_count=$(echo "$cron_expr" | awk '{print NF}')
    [[ "$field_count" -ne 5 ]] && die "Cron expression must have exactly 5 fields, got $field_count: $cron_expr"

    # Build JSON payload with proper escaping
    local escaped_msg escaped_cron escaped_label
    escaped_msg=$(json_escape "$message")
    escaped_cron=$(json_escape "$cron_expr")
    escaped_label=$(json_escape "$label")

    local json="{\"cron\":\"${escaped_cron}\",\"agentId\":\"${agent}\",\"message\":\"${escaped_msg}\",\"channel\":\"${channel}\",\"sender\":\"${sender}\""
    if [[ -n "$label" ]]; then
        json="${json},\"label\":\"${escaped_label}\"}"
    else
        json="${json}}"
    fi

    local response
    response=$(curl -s -X POST "${API_BASE}/api/schedules" \
        -H "Content-Type: application/json" \
        -d "$json")

    if json_ok "$response"; then
        local resp_label resp_cron
        resp_label=$(json_val "$response" "label")
        resp_cron=$(json_val "$response" "cron")
        echo "Schedule created:"
        echo "  Label:   ${resp_label:-unknown}"
        echo "  Cron:    ${resp_cron:-$cron_expr}"
        echo "  Agent:   @$agent"
        echo "  Message: $message"
        echo "  Channel: $channel"
    else
        local err
        err=$(json_val "$response" "error")
        die "${err:-$response}"
    fi
}

cmd_list() {
    local filter_agent=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --agent) filter_agent="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    local url="${API_BASE}/api/schedules"
    if [[ -n "$filter_agent" ]]; then
        url="${url}?agent=${filter_agent}"
    fi

    local response
    response=$(curl -s "$url")

    # Check for empty array
    if [[ "$response" == "[]" ]]; then
        if [[ -n "$filter_agent" ]]; then
            echo "No schedules found for agent @${filter_agent}."
        else
            echo "No tinyclaw schedules found."
        fi
        return
    fi

    echo "Tinyclaw schedules:"
    echo "---"

    # Parse the JSON array using grep to extract each schedule block
    # Extract fields from each object in the array
    local labels crons agents ids enableds
    labels=$(echo "$response" | grep -o '"label":"[^"]*"' | sed 's/"label":"//;s/"$//')
    crons=$(echo "$response" | grep -o '"cron":"[^"]*"' | sed 's/"cron":"//;s/"$//')
    agents=$(echo "$response" | grep -o '"agentId":"[^"]*"' | sed 's/"agentId":"//;s/"$//')
    ids=$(echo "$response" | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"$//')
    enableds=$(echo "$response" | grep -o '"enabled":[a-z]*' | sed 's/"enabled"://')

    # Combine and print
    paste -d'|' <(echo "$labels") <(echo "$crons") <(echo "$agents") <(echo "$ids") <(echo "$enableds") | while IFS='|' read -r lbl crn agt sid enb; do
        local status="enabled"
        [[ "$enb" == "false" ]] && status="disabled"
        echo "  Label: $lbl ($status)"
        echo "  Cron:  $crn"
        echo "  Agent: @$agt"
        echo "  ID:    $sid"
        echo "  ---"
    done
}

cmd_delete() {
    local label="" delete_all=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --label) label="$2"; shift 2 ;;
            --all)   delete_all=true; shift ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    if $delete_all; then
        local response
        response=$(curl -s "${API_BASE}/api/schedules")

        if [[ "$response" == "[]" ]]; then
            echo "No tinyclaw schedules to delete."
            return
        fi

        # Extract all IDs
        local ids
        ids=$(echo "$response" | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"$//')

        if [[ -z "$ids" ]]; then
            echo "No tinyclaw schedules to delete."
            return
        fi

        local count=0
        while IFS= read -r id; do
            curl -s -X DELETE "${API_BASE}/api/schedules/${id}" > /dev/null 2>&1
            count=$((count + 1))
        done <<< "$ids"

        echo "Deleted $count tinyclaw schedule(s)."
        return
    fi

    [[ -z "$label" ]] && die "Provide --label LABEL or --all"

    local response
    response=$(curl -s -X DELETE "${API_BASE}/api/schedules/${label}")

    if json_ok "$response"; then
        echo "Deleted schedule: $label"
    else
        local err
        err=$(json_val "$response" "error")
        die "${err:-Not found}"
    fi
}

# ────────────────────────────────────────────
# Main
# ────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

COMMAND="$1"; shift

case "$COMMAND" in
    create) cmd_create "$@" ;;
    list)   cmd_list "$@" ;;
    delete) cmd_delete "$@" ;;
    help|-h|--help) usage ;;
    *) die "Unknown command: $COMMAND. Use create, list, or delete." ;;
esac
