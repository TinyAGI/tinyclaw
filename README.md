# TinyClaw 🦞

Minimal multi-channel AI assistant with Discord and WhatsApp integration.

## 🎯 What is TinyClaw?

TinyClaw is a lightweight wrapper around Claude CLI and Codex CLI that:

- ✅ Connects Discord (via bot token) and WhatsApp (via QR code)
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
│  Other Channels │──┤   │   Queue      │
│  (future)       │  │   │  Processor   │
└─────────────────┘  │   └──────────────┘
                     │        ↓
                     │   Provider runtime (claude/codex)
                     │        ↓
                     │   Queue (outgoing/)
                     │        ↓
                     └──> Channels send
                          responses
```

## 🚀 Quick Start

### Prerequisites

- macOS or Linux
- One or both of:
  - Claude CLI
  - [Codex CLI](https://developers.openai.com/codex/cli/)
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
  3) Both

Choose [1-3]: 3

✓ Channel: both

Enter your Discord bot token:
(Get one at: https://discord.com/developers/applications)

Token: YOUR_DISCORD_BOT_TOKEN_HERE

✓ Discord token saved

Which AI CLI provider?

  1) Claude CLI
  2) Codex CLI

Choose [1-2]: 2

✓ Provider: codex

Which Codex model?

  1) GPT-5.3-Codex      (recommended)
  2) GPT-5.2
  3) GPT-5.1-Codex-Mini

Choose [1-3]: 1

✓ Codex model: gpt5codex

Heartbeat interval (seconds)?
(How often TinyClaw checks in proactively)

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

### Test It

**Discord:** Send a DM to your bot or mention it in a channel

**WhatsApp:** Send a message to the connected number

You'll get a response! 🤖

## 📋 Commands

```bash
# Start TinyClaw
./tinyclaw.sh start

# Run setup wizard (change channels/provider/model/heartbeat)
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

# Show or switch CLI provider
./tinyclaw.sh cli             # Show current provider
./tinyclaw.sh cli claude
./tinyclaw.sh cli codex

# Switch provider-specific models
./tinyclaw.sh model                           # Show active provider/model
./tinyclaw.sh model claude sonnet            # Claude Sonnet
./tinyclaw.sh model claude opus              # Claude Opus
./tinyclaw.sh model codex gpt5codex          # GPT-5.3-Codex
./tinyclaw.sh model codex gpt5               # GPT-5.2
./tinyclaw.sh model codex gpt5mini           # GPT-5.1-Codex-Mini

# View logs
./tinyclaw.sh logs whatsapp   # WhatsApp activity
./tinyclaw.sh logs discord    # Discord activity
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
- Configures channels (Discord/WhatsApp/Both)
- Collects Discord bot token
- Selects provider and provider-specific model
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

### 4. queue-processor.ts

- Polls incoming queue
- Processes **ONE message at a time**
- Calls selected provider (`claude` or `codex`)
- Writes responses to outgoing queue

### 5. heartbeat-cron.sh

- Runs every 5 minutes
- Sends heartbeat via queue
- Keeps conversation active

### 6. tinyclaw.sh

- Main orchestrator
- Manages tmux session
- CLI interface

## 💬 Message Flow

```
Discord/WhatsApp message arrives
       ↓
Client writes to:
  .tinyclaw/queue/incoming/{discord|whatsapp}_<id>.json
       ↓
queue-processor.ts picks it up
       ↓
Runs: provider-specific command ("claude ... -c -p" or "codex exec/resume --json")
       ↓
Writes to:
  .tinyclaw/queue/outgoing/{discord|whatsapp}_<id>.json
       ↓
Client reads and sends response
       ↓
User receives reply
```

## 📁 Directory Structure

```
tinyclaw/
├── .tinyclaw/            # TinyClaw data
│   ├── settings.json     # Configuration (channel, provider, models, tokens)
│   ├── codex_thread_id   # Codex shared thread state
│   ├── queue/
│   │   ├── incoming/     # New messages
│   │   ├── processing/   # Being processed
│   │   └── outgoing/     # Responses
│   ├── logs/
│   │   ├── discord.log
│   │   ├── whatsapp.log
│   │   ├── queue.log
│   │   └── heartbeat.log
│   ├── channels/         # Runtime channel data
│   ├── whatsapp-session/
│   └── heartbeat.md
├── src/
│   ├── discord-client.ts    # Discord I/O
│   ├── whatsapp-client.ts   # WhatsApp I/O
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
  "channel": "both",
  "cli_provider": "codex",
  "claude_model": "sonnet",
  "codex_model": "gpt5codex",
  "discord_bot_token": "YOUR_TOKEN_HERE",
  "heartbeat_interval": 500
}
```

To reconfigure, run:
```bash
./tinyclaw.sh setup
```

The heartbeat interval is in seconds (default: 500s = ~8 minutes).
This controls how often TinyClaw proactively checks in.

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

Discord and WhatsApp work seamlessly together. Add more channels easily:

**Example: Add Telegram**

```typescript
// telegram-client.ts
// Write to queue
fs.writeFileSync(
  '.tinyclaw/queue/incoming/telegram_<id>.json',
  JSON.stringify({
    channel: 'telegram',
    message,
    chatId,
    timestamp
  })
);

// Read responses from outgoing queue
// Same format as Discord/WhatsApp
```

Queue processor handles all channels automatically!

### ✅ Clean Responses

Uses provider-specific execution:

- Claude provider: `claude ... -c -p`
- Codex provider: `codex exec resume --json ...` with fallback to `codex exec --json ...`
- Codex thread state is stored in `.tinyclaw/codex_thread_id`

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
- Queue files are local (no network exposure)
- Each channel handles its own authentication
- Selected provider CLI runs with your user permissions

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
Assistant: "I'll remind you!"
[5 minutes later via heartbeat]
Assistant: "Don't forget to call mom!"
```

### Code Helper

```
You: "Review my code"
Assistant: [reads files, provides feedback]
You: "Fix the bug"
Assistant: [fixes and commits]
```

### Multi-Device

- WhatsApp on phone
- Discord on desktop/mobile
- CLI for scripts

All channels share the same active provider conversation context!

## 🙏 Credits

- Inspired by [OpenClaw](https://openclaw.ai/) by Peter Steinberger
- Built around Claude CLI and [Codex CLI](https://developers.openai.com/codex/cli/)
- Uses [discord.js](https://discord.js.org/)
- Uses [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js)

## 📄 License

MIT

---

**TinyClaw - Small but mighty!** 🦞✨
