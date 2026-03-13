#!/usr/bin/env bash
# tc-api.sh — Thin wrapper for TinyAGI API operations
# Handles API availability checks and common CRUD operations.
#
# Usage:
#   tc-api.sh status                          # Check API + queue status
#   tc-api.sh agents list                     # List agents
#   tc-api.sh agents get <id>                 # Get agent config
#   tc-api.sh agents create <id> <json>       # Create/update agent
#   tc-api.sh agents delete <id>              # Delete agent
#   tc-api.sh teams list                      # List teams
#   tc-api.sh teams get <id>                  # Get team config
#   tc-api.sh teams create <id> <json>        # Create/update team
#   tc-api.sh teams delete <id>               # Delete team
#   tc-api.sh settings get                    # Get settings
#   tc-api.sh settings update <json>          # Update settings
#   tc-api.sh message <json>                  # Send message
#   tc-api.sh tasks list                      # List tasks
#   tc-api.sh tasks create <json>             # Create task
#   tc-api.sh queue status                    # Queue status
#   tc-api.sh queue dead                      # Dead-letter messages
#   tc-api.sh logs [limit]                    # Recent logs

set -euo pipefail

API_PORT="${TINYAGI_API_PORT:-3777}"
API_BASE="http://localhost:${API_PORT}"

check_api() {
    if ! curl -sf "${API_BASE}/api/queue/status" > /dev/null 2>&1; then
        echo "ERROR: TinyAGI API not reachable at ${API_BASE}" >&2
        echo "Is TinyAGI running? Try: tinyagi start" >&2
        exit 1
    fi
}

cmd="${1:-help}"
shift || true

case "$cmd" in
    status)
        check_api
        echo "=== Queue Status ==="
        curl -sf "${API_BASE}/api/queue/status" | jq .
        echo ""
        echo "=== Agents ==="
        curl -sf "${API_BASE}/api/agents" | jq 'keys'
        echo ""
        echo "=== Teams ==="
        curl -sf "${API_BASE}/api/teams" | jq 'keys'
        ;;

    agents)
        check_api
        sub="${1:-list}"; shift || true
        case "$sub" in
            list) curl -sf "${API_BASE}/api/agents" | jq . ;;
            get)  curl -sf "${API_BASE}/api/agents" | jq --arg id "$1" '.[$id]' ;;
            create)
                id="$1"; shift
                curl -sf -X PUT "${API_BASE}/api/agents/${id}" \
                    -H 'Content-Type: application/json' \
                    -d "$1" | jq .
                ;;
            delete) curl -sf -X DELETE "${API_BASE}/api/agents/$1" | jq . ;;
            *) echo "Unknown agents subcommand: $sub" >&2; exit 1 ;;
        esac
        ;;

    teams)
        check_api
        sub="${1:-list}"; shift || true
        case "$sub" in
            list) curl -sf "${API_BASE}/api/teams" | jq . ;;
            get)  curl -sf "${API_BASE}/api/teams" | jq --arg id "$1" '.[$id]' ;;
            create)
                id="$1"; shift
                curl -sf -X PUT "${API_BASE}/api/teams/${id}" \
                    -H 'Content-Type: application/json' \
                    -d "$1" | jq .
                ;;
            delete) curl -sf -X DELETE "${API_BASE}/api/teams/$1" | jq . ;;
            *) echo "Unknown teams subcommand: $sub" >&2; exit 1 ;;
        esac
        ;;

    settings)
        check_api
        sub="${1:-get}"; shift || true
        case "$sub" in
            get) curl -sf "${API_BASE}/api/settings" | jq . ;;
            update)
                curl -sf -X PUT "${API_BASE}/api/settings" \
                    -H 'Content-Type: application/json' \
                    -d "$1" | jq .
                ;;
            *) echo "Unknown settings subcommand: $sub" >&2; exit 1 ;;
        esac
        ;;

    message)
        check_api
        curl -sf -X POST "${API_BASE}/api/message" \
            -H 'Content-Type: application/json' \
            -d "$1" | jq .
        ;;

    tasks)
        check_api
        sub="${1:-list}"; shift || true
        case "$sub" in
            list) curl -sf "${API_BASE}/api/tasks" | jq . ;;
            create)
                curl -sf -X POST "${API_BASE}/api/tasks" \
                    -H 'Content-Type: application/json' \
                    -d "$1" | jq .
                ;;
            *) echo "Unknown tasks subcommand: $sub" >&2; exit 1 ;;
        esac
        ;;

    queue)
        check_api
        sub="${1:-status}"; shift || true
        case "$sub" in
            status) curl -sf "${API_BASE}/api/queue/status" | jq . ;;
            dead)   curl -sf "${API_BASE}/api/queue/dead" | jq . ;;
            *) echo "Unknown queue subcommand: $sub" >&2; exit 1 ;;
        esac
        ;;

    logs)
        check_api
        limit="${1:-50}"
        curl -sf "${API_BASE}/api/logs?limit=${limit}" | jq .
        ;;

    help|*)
        cat <<'USAGE'
tc-api.sh — TinyAGI API wrapper

Commands:
  status                       Overview (queue + agents + teams)
  agents list|get|create|delete Agent CRUD
  teams  list|get|create|delete Team CRUD
  settings get|update           Settings read/write
  message <json>                Send message to queue
  tasks list|create             Task management
  queue status|dead             Queue inspection
  logs [limit]                  Recent queue logs
USAGE
        ;;
esac
