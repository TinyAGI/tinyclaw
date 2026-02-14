#!/usr/bin/env bash
set -euo pipefail

cd /app

mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.config" "$HOME/.bun" /app/.tinyclaw "$HOME/.tinyclaw/logs" /app/.tinyclaw/logs

# Ensure qmd installed via bun is discoverable even when settings command is empty.
export PATH="$HOME/.bun/bin:$PATH"

case "${1:-start}" in
  start)
    ./tinyclaw.sh start
    # Keep container in foreground while daemon runs in tmux.
    touch "$HOME/.tinyclaw/logs/queue.log" "$HOME/.tinyclaw/logs/telegram.log" "$HOME/.tinyclaw/logs/heartbeat.log"
    exec tail -F "$HOME/.tinyclaw/logs/queue.log" "$HOME/.tinyclaw/logs/telegram.log" "$HOME/.tinyclaw/logs/heartbeat.log"
    ;;
  restart)
    exec ./tinyclaw.sh restart
    ;;
  status)
    exec ./tinyclaw.sh status
    ;;
  bash|sh)
    exec "$@"
    ;;
  *)
    exec ./tinyclaw.sh "$@"
    ;;
esac
