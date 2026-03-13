#!/usr/bin/env bash
# Update management for TinyAGI
# Interactive do_update() moved to src/cli/update.ts

# GitHub repository info
GITHUB_REPO="TinyAGI/tinyagi"
UPDATE_CHECK_CACHE="$HOME/.tinyagi/.update_check"
UPDATE_CHECK_TTL=3600  # Check once per hour

# Get current version
get_current_version() {
    if [ -f "$SCRIPT_DIR/package.json" ]; then
        # Try to extract version from package.json
        if command -v jq &> /dev/null; then
            jq -r '.version' "$SCRIPT_DIR/package.json" 2>/dev/null || echo "unknown"
        else
            grep '"version"' "$SCRIPT_DIR/package.json" | head -1 | sed 's/.*"version": "\(.*\)".*/\1/' || echo "unknown"
        fi
    else
        echo "unknown"
    fi
}

# Get latest version from GitHub
get_latest_version() {
    if ! command -v curl &> /dev/null; then
        return 1
    fi

    # Query GitHub API for latest release
    local response
    response=$(curl -sS -m 5 "https://api.github.com/repos/$GITHUB_REPO/releases/latest" 2>/dev/null)

    if [ $? -ne 0 ] || [ -z "$response" ]; then
        return 1
    fi

    # Extract version tag
    if command -v jq &> /dev/null; then
        echo "$response" | jq -r '.tag_name' 2>/dev/null | sed 's/^v//'
    else
        echo "$response" | grep -o '"tag_name": *"[^"]*"' | sed 's/"tag_name": *"v\{0,1\}\([^"]*\)"/\1/'
    fi
}

# Compare versions (returns 0 if v1 < v2)
version_lt() {
    local v1="$1"
    local v2="$2"

    # Simple numeric comparison (assumes semantic versioning)
    [ "$v1" != "$v2" ] && [ "$(printf '%s\n' "$v1" "$v2" | sort -V | head -n1)" = "$v1" ]
}

# Check if update is available (with caching)
check_for_updates() {
    local force="${1:-false}"

    # Skip if disabled
    if [ "${TINYAGI_SKIP_UPDATE_CHECK:-}" = "1" ]; then
        return 1
    fi

    # Check cache unless forced
    if [ "$force" != "true" ] && [ -f "$UPDATE_CHECK_CACHE" ]; then
        local cache_age=$(( $(date +%s) - $(stat -f %m "$UPDATE_CHECK_CACHE" 2>/dev/null || stat -c %Y "$UPDATE_CHECK_CACHE" 2>/dev/null || echo 0) ))
        if [ "$cache_age" -lt "$UPDATE_CHECK_TTL" ]; then
            # Use cached result
            if [ -s "$UPDATE_CHECK_CACHE" ]; then
                cat "$UPDATE_CHECK_CACHE"
                return 0
            else
                return 1
            fi
        fi
    fi

    local current_version=$(get_current_version)
    local latest_version=$(get_latest_version)

    if [ -z "$latest_version" ] || [ "$latest_version" = "null" ]; then
        # Failed to fetch, clear cache
        rm -f "$UPDATE_CHECK_CACHE"
        return 1
    fi

    # Cache the result
    mkdir -p "$(dirname "$UPDATE_CHECK_CACHE")"

    if version_lt "$current_version" "$latest_version"; then
        # Update available
        echo "$current_version|$latest_version" > "$UPDATE_CHECK_CACHE"
        echo "$current_version|$latest_version"
        return 0
    else
        # No update available
        : > "$UPDATE_CHECK_CACHE"  # Empty cache file
        return 1
    fi
}

# Show update notification
show_update_notification() {
    local current_version="$1"
    local latest_version="$2"

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}⚡ Update Available!${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  Current: ${RED}v${current_version}${NC}"
    echo -e "  Latest:  ${GREEN}v${latest_version}${NC}"
    echo ""
    echo -e "  Update:  ${GREEN}tinyagi update${NC}"
    echo -e "  Changes: ${BLUE}https://github.com/$GITHUB_REPO/releases/v${latest_version}${NC}"
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

