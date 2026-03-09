#!/usr/bin/env bash
# tasks.sh — Manage TinyClaw kanban tasks via the REST API.
#
# Usage:
#   tasks.sh list   [--mine] [--status STATUS]
#   tasks.sh update TASK_ID --status STATUS
#   tasks.sh create --title "TITLE" [--description "DESC"] [--assignee ID] [--assignee-type agent|team]

set -euo pipefail

API_PORT="${TINYCLAW_API_PORT:-3777}"
API_BASE="http://localhost:${API_PORT}"
AGENT_ID="${TINYCLAW_AGENT_ID:-}"

# ────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────

usage() {
    cat <<'USAGE'
tasks.sh — manage TinyClaw kanban tasks

Commands:
  list     List tasks (optionally filtered)
  update   Update a task's status
  create   Create a new task (always in backlog)

List flags:
  --mine              Only show tasks assigned to you
  --status STATUS     Filter by status (backlog, in_progress, review, done)

Update args:
  TASK_ID             The task ID to update (required, first positional arg)
  --status STATUS     New status (required)

Create flags:
  --title "TITLE"           Task title (required)
  --description "DESC"      Task description (optional)
  --assignee ID             Assignee agent/team ID (optional, defaults to self)
  --assignee-type TYPE      "agent" or "team" (default: agent)

Examples:
  tasks.sh list --mine
  tasks.sh update task_123_abc --status done
  tasks.sh create --title "Fix auth bug" --description "Login fails on mobile"
USAGE
    exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ────────────────────────────────────────────
# Commands
# ────────────────────────────────────────────

cmd_list() {
    local filter_mine=false filter_status=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --mine)   filter_mine=true; shift ;;
            --status) filter_status="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    local result
    result=$(curl -sf "${API_BASE}/api/tasks") || die "Failed to reach API at ${API_BASE}"

    local jq_filter="."

    if $filter_mine; then
        [[ -z "$AGENT_ID" ]] && die "--mine requires TINYCLAW_AGENT_ID to be set"
        jq_filter="${jq_filter} | map(select(.assignee == \"${AGENT_ID}\"))"
    fi

    if [[ -n "$filter_status" ]]; then
        jq_filter="${jq_filter} | map(select(.status == \"${filter_status}\"))"
    fi

    echo "$result" | jq -r "${jq_filter} | .[] | \"[\(.status)] \(.id)  \(.title)  (assignee: \(.assignee | if . == \"\" then \"unassigned\" else . end))\""

    local count
    count=$(echo "$result" | jq -r "${jq_filter} | length")
    echo "---"
    echo "${count} task(s)"
}

cmd_update() {
    [[ $# -lt 1 ]] && die "Task ID is required as first argument"
    local task_id="$1"; shift
    local status=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --status) status="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    [[ -z "$status" ]] && die "--status is required"

    case "$status" in
        backlog|in_progress|review|done) ;;
        *) die "Invalid status: $status. Must be one of: backlog, in_progress, review, done" ;;
    esac

    local result
    result=$(curl -sf -X PUT "${API_BASE}/api/tasks/${task_id}" \
        -H 'Content-Type: application/json' \
        -d "{\"status\":\"${status}\"}") || die "Failed to update task ${task_id}"

    echo "Task ${task_id} updated to: ${status}"
}

cmd_create() {
    local title="" description="" assignee="" assignee_type="agent"

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --title)         title="$2"; shift 2 ;;
            --description)   description="$2"; shift 2 ;;
            --assignee)      assignee="$2"; shift 2 ;;
            --assignee-type) assignee_type="$2"; shift 2 ;;
            *) die "Unknown flag: $1" ;;
        esac
    done

    [[ -z "$title" ]] && die "--title is required"

    # Default assignee to self
    if [[ -z "$assignee" && -n "$AGENT_ID" ]]; then
        assignee="$AGENT_ID"
        assignee_type="agent"
    fi

    # Build JSON payload
    local payload
    payload=$(jq -n \
        --arg title "$title" \
        --arg description "$description" \
        --arg assignee "$assignee" \
        --arg assigneeType "$assignee_type" \
        --arg status "backlog" \
        '{title: $title, description: $description, assignee: $assignee, assigneeType: $assigneeType, status: $status}')

    local result
    result=$(curl -sf -X POST "${API_BASE}/api/tasks" \
        -H 'Content-Type: application/json' \
        -d "$payload") || die "Failed to create task"

    local task_id
    task_id=$(echo "$result" | jq -r '.task.id')
    echo "Task created: ${task_id} — ${title}"
}

# ────────────────────────────────────────────
# Main
# ────────────────────────────────────────────

[[ $# -lt 1 ]] && usage

COMMAND="$1"; shift

case "$COMMAND" in
    list)   cmd_list "$@" ;;
    update) cmd_update "$@" ;;
    create) cmd_create "$@" ;;
    help|-h|--help) usage ;;
    *) die "Unknown command: $COMMAND. Use list, update, or create." ;;
esac
