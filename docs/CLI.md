# TinyClaw CLI Guide

Complete guide to using TinyClaw from the command line without Discord, Telegram, or WhatsApp.

## Quick Start

### 1. Setup (CLI-Only Mode)

```bash
# Quick setup without messaging channels
./tinyclaw.sh setup --cli-only

# Or manual setup saying "no" to all channels
./tinyclaw.sh setup
# Answer "N" to Telegram, Discord, and WhatsApp
```

### 2. Start TinyClaw

```bash
# Option A: With tmux (for monitoring)
./tinyclaw.sh start

# Option B: Without tmux (background mode, recommended)
./tinyclaw.sh start --no-tmux
```

### 3. Send Your First Message

```bash
# Send a message
./tinyclaw.sh send "Hello, what can you do?"

# Wait and receive the response
./tinyclaw.sh receive --wait 60

# Or use chat to do both at once
./tinyclaw.sh chat "Hello, what can you do?"
```

## Available Commands

### Basic Communication

```bash
# Send a message (async, returns immediately)
./tinyclaw.sh send "Your message here"

# Send to specific agent
./tinyclaw.sh send "@coder fix the bug in auth.ts"

# Send to team
./tinyclaw.sh send "@squad build a REST API"

# Send and wait for response
./tinyclaw.sh chat "Create a Python function"

# Check for pending responses
./tinyclaw.sh receive

# Wait for response with timeout
./tinyclaw.sh receive --wait 60
```

### Daemon Control

```bash
# Start TinyClaw
./tinyclaw.sh start

# Start without tmux (background mode)
./tinyclaw.sh start --no-tmux

# Check status
./tinyclaw.sh status

# Stop TinyClaw
./tinyclaw.sh stop

# Restart
./tinyclaw.sh restart

# View logs
./tinyclaw.sh logs queue      # Queue processor logs
./tinyclaw.sh logs daemon     # Daemon logs
./tinyclaw.sh logs all        # All logs
```

### Agent Management

```bash
# List all agents
./tinyclaw.sh agent list

# Show specific agent
./tinyclaw.sh agent show coder

# Add new agent (interactive)
./tinyclaw.sh agent add

# Reset agent conversation
./tinyclaw.sh agent reset coder

# Remove agent
./tinyclaw.sh agent remove coder

# Change agent provider
./tinyclaw.sh agent provider coder opencode --model sonnet
```

### Team Management

```bash
# List teams
./tinyclaw.sh team list

# Add team (interactive)
./tinyclaw.sh team add

# Show team
./tinyclaw.sh team show squad

# Remove team
./tinyclaw.sh team remove squad

# Visualize team activity
./tinyclaw.sh team visualize squad
```

### System Commands

```bash
# Show help
./tinyclaw.sh

# Setup wizard
./tinyclaw.sh setup

# Switch AI provider
./tinyclaw.sh provider opencode --model sonnet

# Switch model
./tinyclaw.sh model sonnet
```

## Example Workflows

### Single Agent Workflow

```bash
# Start TinyClaw
./tinyclaw.sh start --no-tmux

# Ask a question and get answer
./tinyclaw.sh chat "How do I reverse a string in Python?"

# The response will be displayed and any files created will be in:
# ~/tinyclaw-workspace/default/
```

### Multi-Agent Workflow

```bash
# Start TinyClaw
./tinyclaw.sh start --no-tmux

# Send to team and watch responses
./tinyclaw.sh send "@squad Build an authentication system"
./tinyclaw.sh receive --wait 120

# Or visualize in real-time
./tinyclaw.sh team visualize squad
```

### Sequential Agent Workflow

```bash
# Architect designs
./tinyclaw.sh chat "@architect Design a caching system"

# Coder implements
./tinyclaw.sh chat "@coder Implement the caching system"

# Reviewer checks
./tinyclaw.sh chat "@reviewer Review the implementation"
```

## Viewing Results

### Chat History

Conversations are saved to:
```
~/.tinyclaw/chats/
```

View with:
```bash
# List all chat files
ls ~/.tinyclaw/chats/

# View a specific conversation
cat ~/.tinyclaw/chats/cli/2026-02-24_14-30-00.md
```

### Created Files

Agents work in their workspace directories:
```
~/tinyclaw-workspace/
├── default/          # Default agent
├── coder/           # Coder agent (if configured)
├── reviewer/        # Reviewer agent (if configured)
└── ...
```

### Logs

```bash
# View queue processor logs
./tinyclaw.sh logs queue

# Follow logs in real-time
./tinyclaw.sh logs queue &

# View all logs
./tinyclaw.sh logs all
```

## Configuration

### settings.json Location

```
~/.tinyclaw/settings.json
```

### Example CLI-Only Configuration

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "channels": {
    "enabled": [],
    "discord": { "bot_token": "" },
    "telegram": { "bot_token": "" },
    "whatsapp": {}
  },
  "agents": {
    "default": {
      "name": "Assistant",
      "provider": "opencode",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/default"
    }
  },
  "models": {
    "provider": "opencode",
    "opencode": { "model": "sonnet" }
  },
  "monitoring": {
    "heartbeat_interval": 3600
  }
}
```

## Common Issues

### "Failed to enqueue message"

TinyClaw is not running. Start it:
```bash
./tinyclaw.sh start --no-tmux
```

### "No pending responses"

The AI is still processing. Wait longer:
```bash
./tinyclaw.sh receive --wait 120
```

Or check the logs:
```bash
./tinyclaw.sh logs queue
```

### Agent not responding

Reset the agent:
```bash
./tinyclaw.sh agent reset <agent_id>
```

### Cannot find opencode command

Install OpenCode:
```bash
curl -fsSL https://opencode.ai/install | bash
```

## Environment Variables

Optional variables you can set:

```bash
# API port (default: 3777)
export TINYCLAW_API_PORT=3777

# Workspace path
export TINYCLAW_WORKSPACE=$HOME/tinyclaw-workspace

# OpenCode API keys
export ANTHROPIC_API_KEY=your_key
export OPENAI_API_KEY=your_key
```

## Tips

1. Use `--no-tmux` for headless/background operation
2. Use `chat` command for simple interactions (combines send + receive)
3. Use `receive --wait` when you need to wait for responses
4. Check logs if agents are not responding
5. Use `team visualize` to watch multi-agent collaboration in real-time

## See Also

- [5-Agent Squad](5-AGENT-SQUAD.md) - Multi-agent collaboration guide
- [OpenCode Integration](OPENCODE.md) - OpenCode-specific documentation
- [AGENTS.md](../AGENTS.md) - General agent documentation
