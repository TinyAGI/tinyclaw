# TinyClaw 🦞

Minimal multi-channel AI assistant with Discord, WhatsApp, and Telegram integration.

## 🎯 What is TinyClaw?

TinyClaw is a lightweight wrapper around [Claude Code](https://claude.com/claude-code) that:

- ✅ Connects Discord (via bot token), WhatsApp (via QR code), and Telegram (via bot token + allowlist)
- ✅ Processes messages sequentially (no race conditions)
- ✅ Maintains conversation context
- ✅ Runs 24/7 in tmux
- ✅ Multi-channel ready (Telegram, Slack, etc.)

**Key innovation:** File-based queue system prevents race conditions and enables seamless multi-channel support.

## 📐 Architecture

```
┌─────────────────┐
│  Discord        │──┐
│  Client         │  │
└─────────────────┘  │
                     │
┌─────────────────┐  │
│  WhatsApp       │──┤
│  Client         │  │
└─────────────────┘  ├──→ Queue (incoming/)
                     │        ↓
┌─────────────────┐  │   ┌──────────────┐
│  Telegram       │──┤   │   Queue      │
│  Client         │  │   │  Processor   │
└─────────────────┘  │   └──────────────┘
                     │        ↓
                     │   claude -c -p
                     │        ↓
                     │   Queue (outgoing/)
                     │        ↓
                     └──> Channels send
                          responses
```

## 🚀 Quick Start

### Prerequisites

- macOS or Linux
- [Claude Code](https://claude.com/claude-code) installed
- Node.js v14+
- tmux

### Installation

```bash
cd /path/to/tinyclaw

# Install dependencies
npm install

# Start TinyClaw (first run triggers setup wizard)
./tinyclaw.sh start
```

### First Run - Setup Wizard

On first start, you'll see an interactive setup wizard:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  TinyClaw - Setup Wizard
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Which messaging channel do you want to use?

  1) Discord
  2) WhatsApp
  3) Telegram
  4) Discord + WhatsApp
  5) Discord + Telegram
  6) WhatsApp + Telegram
  7) All (Discord + WhatsApp + Telegram)

Choose [1-7]: 3

✓ Channel: telegram

Enter your Telegram bot token:
(Get one at: https://t.me/BotFather)

Token: YOUR_TELEGRAM_BOT_TOKEN_HERE

Enter allowed Telegram chat/user ID:
(Only this ID can use the bot)

Allowed ID: 123456789

✓ Telegram credentials saved

Which Claude model?

  1) Sonnet  (fast, recommended)
  2) Opus    (smartest)

Choose [1-2]: 1

✓ Model: sonnet

Heartbeat interval (seconds)?
(How often Claude checks in proactively)

Interval [default: 500]: 500

✓ Heartbeat interval: 500s

✓ Configuration saved to .tinyclaw/settings.json
```

### Discord Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the bot token
5. Enable "Message Content Intent" in Bot settings
6. Invite the bot to your server using OAuth2 URL Generator

### WhatsApp Setup

After starting, a QR code will appear if WhatsApp is enabled:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        WhatsApp QR Code
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[QR CODE HERE]

📱 Scan with WhatsApp:
   Settings → Linked Devices → Link a Device
```

Scan it with your phone. **Done!** 🎉

### Telegram Setup

1. Open Telegram and create a bot via [@BotFather](https://t.me/BotFather)
2. Copy your bot token
3. Send a message to your bot from the account you want to allow
4. Get your chat ID:

```bash
TOKEN='YOUR_TELEGRAM_BOT_TOKEN'
curl -4 -sS "https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=0&limit=20" \
  | jq -r '.result[] | select(.message!=null) | .message.chat.id' | sort -u
```

Use that ID as `telegram_allowed_id` in setup.

### Test It

**Discord:** Send a DM to your bot or mention it in a channel

**WhatsApp:** Send a message to the connected number

**Telegram:** Send a message to your bot from the allowlisted account

You'll get a response! 🤖

## 📋 Commands

```bash
# Start TinyClaw
./tinyclaw.sh start

# Run setup wizard (change channels/model/heartbeat)
./tinyclaw.sh setup

# Check status
./tinyclaw.sh status

# Send manual message
./tinyclaw.sh send "What's the weather?"

# Reset conversation
./tinyclaw.sh reset

# Reset channel authentication
./tinyclaw.sh channels reset whatsapp  # Clear WhatsApp session
./tinyclaw.sh channels reset discord   # Shows Discord reset instructions
./tinyclaw.sh channels reset telegram  # Shows Telegram reset instructions

# Switch Claude model
./tinyclaw.sh model           # Show current model
./tinyclaw.sh model sonnet    # Switch to Sonnet (fast)
./tinyclaw.sh model opus      # Switch to Opus (smartest)

# View logs
./tinyclaw.sh logs whatsapp   # WhatsApp activity
./tinyclaw.sh logs discord    # Discord activity
./tinyclaw.sh logs telegram   # Telegram activity
./tinyclaw.sh logs queue      # Queue processing
./tinyclaw.sh logs heartbeat  # Heartbeat checks

# Attach to tmux
./tinyclaw.sh attach

# Restart
./tinyclaw.sh restart

# Stop
./tinyclaw.sh stop
```

## 🔧 Components

### 1. setup-wizard.sh

- Interactive setup on first run
- Configures channels (Discord/WhatsApp/Telegram and combinations)
- Collects Discord bot token
- Collects Telegram bot token + allowlisted ID
- Selects Claude model
- Writes to `.tinyclaw/settings.json`

### 2. discord-client.ts

- Connects to Discord via bot token
- Listens for DMs and mentions
- Writes incoming messages to queue
- Reads responses from queue
- Sends replies back

### 3. whatsapp-client.ts

- Connects to WhatsApp via QR code
- Writes incoming messages to queue
- Reads responses from queue
- Sends replies back

### 4. clients/telegram.ts

- Connects to Telegram via long polling
- Allows only configured chat/user ID
- Writes incoming messages to queue
- Reads responses from queue
- Sends replies back

### 5. queue-processor.ts

- Polls incoming queue
- Processes **ONE message at a time**
- Calls `claude -c -p`
- Writes responses to outgoing queue

### 6. heartbeat-cron.sh

- Runs every 5 minutes
- Sends heartbeat via queue
- Keeps conversation active

### 7. tinyclaw.sh

- Main orchestrator
- Manages tmux session
- CLI interface

## 💬 Message Flow

```
Discord/WhatsApp/Telegram message arrives
       ↓
Client writes to:
  .tinyclaw/queue/incoming/{discord|whatsapp|telegram}_<id>.json
       ↓
queue-processor.ts picks it up
       ↓
Runs: claude -c -p "message"
       ↓
Writes to:
  .tinyclaw/queue/outgoing/{discord|whatsapp|telegram}_<id>.json
       ↓
Client reads and sends response
       ↓
User receives reply
```

## 📁 Directory Structure

```
tinyclaw/
├── .claude/              # Claude Code config
│   ├── settings.json     # Hooks config
│   └── hooks/            # Hook scripts
├── .tinyclaw/            # TinyClaw data
│   ├── settings.json     # Configuration (channel, model, tokens)
│   ├── queue/
│   │   ├── incoming/     # New messages
│   │   ├── processing/   # Being processed
│   │   └── outgoing/     # Responses
│   ├── logs/
│   │   ├── discord.log
│   │   ├── whatsapp.log
│   │   ├── telegram.log
│   │   ├── queue.log
│   │   └── heartbeat.log
│   ├── channels/         # Runtime channel data
│   ├── whatsapp-session/
│   └── heartbeat.md
├── src/
│   ├── discord-client.ts    # Discord I/O
│   ├── whatsapp-client.ts   # WhatsApp I/O
│   ├── clients/
│   │   └── telegram.ts      # Telegram I/O
│   └── queue-processor.ts   # Message processing
├── dist/                 # TypeScript build output
├── setup-wizard.sh       # Interactive setup
├── tinyclaw.sh           # Main script
└── heartbeat-cron.sh     # Health checks
```

## 🔄 Reset Conversation

### Via CLI

```bash
./tinyclaw.sh reset
```

### Via WhatsApp

Send: `!reset` or `/reset`

Next message starts fresh (no conversation history).

## ⚙️ Configuration

### Settings File

All configuration is stored in `.tinyclaw/settings.json`:

```json
{
  "channel": "telegram",
  "model": "sonnet",
  "discord_bot_token": "",
  "telegram_token": "YOUR_TELEGRAM_BOT_TOKEN",
  "telegram_allowed_id": "123456789",
  "heartbeat_interval": 500
}
```

To reconfigure, run:
```bash
./tinyclaw.sh setup
```

The heartbeat interval is in seconds (default: 500s = ~8 minutes).
This controls how often Claude proactively checks in.

### Heartbeat Prompt

Edit `.tinyclaw/heartbeat.md`:

```markdown
Check for:

1. Pending tasks
2. Errors
3. Unread messages

Take action if needed.
```

## 📊 Monitoring

### View Logs

```bash
# WhatsApp activity
tail -f .tinyclaw/logs/whatsapp.log

# Telegram activity
tail -f .tinyclaw/logs/telegram.log

# Queue processing
tail -f .tinyclaw/logs/queue.log

# Heartbeat checks
tail -f .tinyclaw/logs/heartbeat.log

# All logs
./tinyclaw.sh logs daemon
```

### Watch Queue

```bash
# Incoming messages
watch -n 1 'ls -lh .tinyclaw/queue/incoming/'

# Outgoing responses
watch -n 1 'ls -lh .tinyclaw/queue/outgoing/'
```

## 🎨 Features

### ✅ No Race Conditions

Messages processed **sequentially**, one at a time:

```
Message 1 → Process → Done
Message 2 → Wait → Process → Done
Message 3 → Wait → Process → Done
```

### ✅ Multi-Channel Support

Discord, WhatsApp, and Telegram work seamlessly together. Add more channels using the same queue contract.

### ✅ Clean Responses

Uses `claude -c -p`:

- `-c` = continue conversation
- `-p` = print mode (clean output)
- No tmux capture needed

### ✅ Persistent Sessions

WhatsApp session persists across restarts:

```bash
# First time: Scan QR code
./tinyclaw.sh start

# Subsequent starts: Auto-connects
./tinyclaw.sh restart
```

## 🔐 Security

- WhatsApp session stored locally in `.tinyclaw/whatsapp-session/`
- Telegram access restricted by allowlisted chat/user ID
- Queue files are local (no network exposure)
- Each channel handles its own authentication
- Claude runs with your user permissions

## 🐛 Troubleshooting

### WhatsApp not connecting

```bash
# Check logs
./tinyclaw.sh logs whatsapp

# Reset WhatsApp authentication
./tinyclaw.sh channels reset whatsapp
./tinyclaw.sh restart
```

### Discord not connecting

```bash
# Check logs
./tinyclaw.sh logs discord

# Update Discord bot token
./tinyclaw.sh setup
```

### Telegram not responding

```bash
# Check logs
./tinyclaw.sh logs telegram

# Verify token
TOKEN='YOUR_TELEGRAM_BOT_TOKEN'
curl -sS "https://api.telegram.org/bot${TOKEN}/getMe"

# Reconfigure Telegram credentials
./tinyclaw.sh setup
```

### Messages not processing

```bash
# Check queue processor
./tinyclaw.sh status

# Check queue
ls -la .tinyclaw/queue/incoming/

# View queue logs
./tinyclaw.sh logs queue
```

### QR code not showing

```bash
# Attach to tmux to see the QR code
tmux attach -t tinyclaw
```

## 🚀 Production Deployment

### Using systemd

```bash
sudo systemctl enable tinyclaw
sudo systemctl start tinyclaw
```

### Using PM2

```bash
pm2 start tinyclaw.sh --name tinyclaw
pm2 save
```

### Using supervisor

```ini
[program:tinyclaw]
command=/path/to/tinyclaw/tinyclaw.sh start
autostart=true
autorestart=true
```

## 🎯 Use Cases

### Personal AI Assistant

```
You: "Remind me to call mom"
Claude: "I'll remind you!"
[5 minutes later via heartbeat]
Claude: "Don't forget to call mom!"
```

### Code Helper

```
You: "Review my code"
Claude: [reads files, provides feedback]
You: "Fix the bug"
Claude: [fixes and commits]
```

### Multi-Device

- WhatsApp on phone
- Discord on desktop/mobile
- CLI for scripts

All channels share the same Claude conversation!

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built on [Claude Code](https://claude.com/claude-code)
- Uses [discord.js](https://discord.js.org/)
- Uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)
- Uses [node-telegram-bot-api](https://github.com/yagop/node-telegram-bot-api)

## 📄 License

MIT

---

**TinyClaw - Small but mighty!** 🦞✨
