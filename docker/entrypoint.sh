#!/usr/bin/env bash
set -euo pipefail

cd /app

mkdir -p "$HOME/.claude" "$HOME/.codex" "$HOME/.config" /app/.tinyclaw

case "${1:-start}" in
  start)
    exec ./tinyclaw.sh start
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
