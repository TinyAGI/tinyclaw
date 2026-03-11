#!/usr/bin/env bash
# TinyAGI Migration Script
# Migrates pre-0.0.10 "tinyclaw" installations to the "tinyagi" naming.
#
# What it does:
#   1. Renames ~/.tinyclaw/ → ~/.tinyagi/
#   2. Renames tinyclaw.db → tinyagi.db inside the data directory
#   3. Removes old CLI symlinks (bin/tinyclaw)
#   4. Prints a summary of what was changed
#
# Safe to run multiple times — skips steps that are already done.

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

OLD_HOME="$HOME/.tinyclaw"
NEW_HOME="$HOME/.tinyagi"
OLD_DB="tinyclaw.db"
NEW_DB="tinyagi.db"

changes=0

echo -e "${BLUE}TinyAGI Migration (tinyclaw → tinyagi)${NC}"
echo "========================================="
echo ""

# ── Step 1: Rename data directory ────────────────────────────────────────────

if [ -d "$OLD_HOME" ] && [ ! -d "$NEW_HOME" ]; then
    echo -e "Renaming ${YELLOW}~/.tinyclaw${NC} → ${GREEN}~/.tinyagi${NC}"
    mv "$OLD_HOME" "$NEW_HOME"
    changes=$((changes + 1))
elif [ -d "$OLD_HOME" ] && [ -d "$NEW_HOME" ]; then
    echo -e "${YELLOW}Warning: Both ~/.tinyclaw and ~/.tinyagi exist.${NC}"
    echo "  Merging is not automatic — please reconcile manually."
    echo "  Old: $OLD_HOME"
    echo "  New: $NEW_HOME"
    echo ""
elif [ -d "$NEW_HOME" ]; then
    echo -e "${GREEN}✓${NC} ~/.tinyagi already exists — skipping directory rename."
else
    echo -e "${YELLOW}No ~/.tinyclaw directory found — nothing to migrate.${NC}"
fi

# ── Step 2: Rename database file ─────────────────────────────────────────────

DATA_DIR="$NEW_HOME"
if [ -d "$DATA_DIR" ]; then
    if [ -f "$DATA_DIR/$OLD_DB" ] && [ ! -f "$DATA_DIR/$NEW_DB" ]; then
        echo -e "Renaming ${YELLOW}$OLD_DB${NC} → ${GREEN}$NEW_DB${NC}"
        mv "$DATA_DIR/$OLD_DB" "$DATA_DIR/$NEW_DB"
        # Also rename WAL/SHM files if they exist (SQLite)
        [ -f "$DATA_DIR/${OLD_DB}-wal" ] && mv "$DATA_DIR/${OLD_DB}-wal" "$DATA_DIR/${NEW_DB}-wal"
        [ -f "$DATA_DIR/${OLD_DB}-shm" ] && mv "$DATA_DIR/${OLD_DB}-shm" "$DATA_DIR/${NEW_DB}-shm"
        changes=$((changes + 1))
    elif [ -f "$DATA_DIR/$NEW_DB" ]; then
        echo -e "${GREEN}✓${NC} $NEW_DB already exists — skipping database rename."
    elif [ -f "$DATA_DIR/$OLD_DB" ] && [ -f "$DATA_DIR/$NEW_DB" ]; then
        echo -e "${YELLOW}Warning: Both $OLD_DB and $NEW_DB exist in $DATA_DIR${NC}"
        echo "  Please reconcile manually."
    fi
fi

# ── Step 3: Remove old CLI symlinks ──────────────────────────────────────────

for dir in "/usr/local/bin" "$HOME/.local/bin"; do
    if [ -L "$dir/tinyclaw" ]; then
        echo -e "Removing old symlink ${YELLOW}$dir/tinyclaw${NC}"
        rm "$dir/tinyclaw"
        changes=$((changes + 1))
    fi
done

# ── Step 4: Check for old environment variables ─────────────────────────────

echo ""
if env | grep -q "^TINYCLAW_"; then
    echo -e "${YELLOW}Warning: TINYCLAW_* environment variables detected in your shell:${NC}"
    env | grep "^TINYCLAW_" | while read -r line; do
        echo "  $line"
    done
    echo ""
    echo "  Update these to use the TINYAGI_ prefix instead."
    echo "  For example: TINYCLAW_HOME → TINYAGI_HOME"
fi

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
if [ "$changes" -gt 0 ]; then
    echo -e "${GREEN}✓ Migration complete — $changes change(s) applied.${NC}"
else
    echo -e "${GREEN}✓ Nothing to migrate — already up to date.${NC}"
fi
echo ""
echo "Next steps:"
echo "  1. Run ./scripts/install.sh to install the new 'tinyagi' CLI"
echo "  2. Verify with: tinyagi status"
echo ""
