#!/bin/bash
# TinyClaw Setup Wizard

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SETTINGS_FILE="$SCRIPT_DIR/.tinyclaw/settings.json"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

mkdir -p "$SCRIPT_DIR/.tinyclaw"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  TinyClaw - Setup Wizard${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Channel selection
echo "Which messaging channel do you want to use?"
echo ""
echo "  1) Discord"
echo "  2) WhatsApp"
echo "  3) Both"
echo ""
read -rp "Choose [1-3]: " CHANNEL_CHOICE

case "$CHANNEL_CHOICE" in
    1) CHANNEL="discord" ;;
    2) CHANNEL="whatsapp" ;;
    3) CHANNEL="both" ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
echo -e "${GREEN}✓ Channel: $CHANNEL${NC}"
echo ""

# Discord bot token (if needed)
DISCORD_TOKEN=""
if [[ "$CHANNEL" == "discord" ]] || [[ "$CHANNEL" == "both" ]]; then
    echo "Enter your Discord bot token:"
    echo -e "${YELLOW}(Get one at: https://discord.com/developers/applications)${NC}"
    echo ""
    read -rp "Token: " DISCORD_TOKEN

    if [ -z "$DISCORD_TOKEN" ]; then
        echo -e "${RED}Discord bot token is required${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓ Discord token saved${NC}"
    echo ""
fi

# CLI provider selection
echo "Which AI CLI provider?"
echo ""
echo "  1) Claude CLI"
echo "  2) Codex CLI"
echo ""
read -rp "Choose [1-2]: " PROVIDER_CHOICE

case "$PROVIDER_CHOICE" in
    1) CLI_PROVIDER="claude" ;;
    2) CLI_PROVIDER="codex" ;;
    *)
        echo -e "${RED}Invalid choice${NC}"
        exit 1
        ;;
esac
echo -e "${GREEN}✓ Provider: $CLI_PROVIDER${NC}"
echo ""

# Model selection (provider-specific)
CLAUDE_MODEL="sonnet"
CODEX_MODEL="gpt5codex"

if [ "$CLI_PROVIDER" = "claude" ]; then
    echo "Which Claude model?"
    echo ""
    echo "  1) Sonnet  (fast, recommended)"
    echo "  2) Opus    (smartest)"
    echo ""
    read -rp "Choose [1-2]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) CLAUDE_MODEL="sonnet" ;;
        2) CLAUDE_MODEL="opus" ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Claude model: $CLAUDE_MODEL${NC}"
else
    echo "Which Codex model?"
    echo ""
    echo "  1) GPT-5.3-Codex      (recommended)"
    echo "  2) GPT-5.2"
    echo "  3) GPT-5.1-Codex-Mini"
    echo ""
    read -rp "Choose [1-3]: " MODEL_CHOICE

    case "$MODEL_CHOICE" in
        1) CODEX_MODEL="gpt5codex" ;;
        2) CODEX_MODEL="gpt5" ;;
        3) CODEX_MODEL="gpt5mini" ;;
        *)
            echo -e "${RED}Invalid choice${NC}"
            exit 1
            ;;
    esac
    echo -e "${GREEN}✓ Codex model: $CODEX_MODEL${NC}"
fi
echo ""

# Heartbeat interval
echo "Heartbeat interval (seconds)?"
echo -e "${YELLOW}(How often TinyClaw checks in proactively)${NC}"
echo ""
read -rp "Interval [default: 500]: " HEARTBEAT_INPUT
HEARTBEAT_INTERVAL=${HEARTBEAT_INPUT:-500}

# Validate it's a number
if ! [[ "$HEARTBEAT_INTERVAL" =~ ^[0-9]+$ ]]; then
    echo -e "${RED}Invalid interval, using default 500${NC}"
    HEARTBEAT_INTERVAL=500
fi
echo -e "${GREEN}✓ Heartbeat interval: ${HEARTBEAT_INTERVAL}s${NC}"
echo ""

# Write settings.json
cat > "$SETTINGS_FILE" <<EOF2
{
  "channel": "$CHANNEL",
  "cli_provider": "$CLI_PROVIDER",
  "claude_model": "$CLAUDE_MODEL",
  "codex_model": "$CODEX_MODEL",
  "discord_bot_token": "$DISCORD_TOKEN",
  "heartbeat_interval": $HEARTBEAT_INTERVAL
}
EOF2

echo -e "${GREEN}✓ Configuration saved to .tinyclaw/settings.json${NC}"
echo ""
echo "You can now start TinyClaw:"
echo -e "  ${GREEN}./tinyclaw.sh start${NC}"
echo ""
