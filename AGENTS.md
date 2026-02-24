TinyClaw - Multi-team Personal Assistants

Multi-agent, multi-team, multi-channel 24/7 AI assistant system.

## About This Project

TinyClaw is a system for running multiple teams of AI agents that collaborate with each other simultaneously with isolated workspaces. It includes:

- Multi-agent architecture with specialized roles
- Team collaboration with chain execution and fan-out
- Channel integrations (Discord, WhatsApp, Telegram)
- Web portal (TinyOffice) for browser-based management
- SQLite queue system for message processing

## Available Skills

This project includes several agent skills in `.agents/skills/`:

- **agent-browser**: Browser automation for testing and web interaction
- **imagegen**: Image generation and editing via OpenAI API
- **schedule**: Cron-based scheduled tasks for agents
- **send-user-message**: Send proactive messages to users
- **skill-creator**: Guide for creating new skills

## Team Communication

When working with teammates, you can mention them using Opencode's syntax:

- `[@coder fix the login bug]` — routes your message to the `coder` agent
- `[@coder,reviewer check this PR]` — routes to multiple teammates

## Guidelines

- **Keep messages short.** Say what you need in 2-3 sentences. Don't repeat context the recipient already has.
- **Minimize back-and-forth.** Each round-trip costs time and tokens. Ask complete questions, give complete answers.
- **Don't re-mention agents who haven't responded yet.** Wait for their responses to arrive.
- **Respond to the user's task.** Your job is to help the user, not to hold meetings.
- **Only mention teammates when you actually need something from them.**

## File Exchange

Files can be exchanged through the `~/.tinyclaw/files` directory:

- **Incoming files**: User uploads are downloaded to `.tinyclaw/files/`
- **Outgoing files**: Place files in `.tinyclaw/files/` and reference them with `[send_file: /path/to/file]`

## Project Structure

```
tinyclaw/
├── src/                  # TypeScript sources
├── dist/                 # Compiled output
├── lib/                  # Runtime scripts
├── scripts/              # Installation and utility scripts
├── tinyoffice/           # Next.js web portal
├── .agents/skills/       # Agent skills and tools
├── .tinyclaw/            # Runtime data and configuration
└── opencode.json         # Opencode configuration
```

## Development

To work on this project:

1. Run `npm install` to install dependencies
2. Run `npm run build` to compile TypeScript
3. Use available skills via the `skill` tool when appropriate

## Testing

- Verify channel clients work with their respective APIs
- Test queue processing with the SQLite database
- Check team chain execution in the visualizer
