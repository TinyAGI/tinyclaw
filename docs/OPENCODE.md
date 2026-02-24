# OpenCode Integration

TinyClaw integrates with [OpenCode](https://opencode.ai), an open-source AI coding agent CLI that can be used as an alternative to Claude Code.

## What OpenCode Provides

- Terminal-based interface (TUI) for interactive sessions
- Non-interactive mode (`opencode run`) for automation
- Built-in agent system with custom configurations
- Skill system for specialized tasks
- Multi-provider support (Anthropic, OpenAI, and others)

## Configuration Files

### Project-Level Config (opencode.json)

The root `opencode.json` in your project defines available agents:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "instructions": ["AGENTS.md"],
  "agent": {
    "build": {
      "mode": "primary",
      "description": "Build agent with full tool access",
      "prompt": "You are a helpful AI assistant...",
      "tools": { "skill": true, "write": true, "edit": true, "bash": true }
    },
    "plan": {
      "mode": "primary",
      "description": "Planning agent for analysis",
      "prompt": "Analyze code without making changes...",
      "tools": { "skill": true, "write": false, "edit": false, "bash": false }
    }
  },
  "permission": {
    "skill": { "*": "allow" }
  }
}
```

### Agent-Level Config

Each agent workspace gets its own `opencode.json` when created with `provider: 'opencode'`.

## Setting Up OpenCode

### 1. Install OpenCode

```bash
curl -fsSL https://opencode.ai/install | bash
```

### 2. Authenticate

```bash
opencode auth login
```

Or set environment variables:
```bash
export ANTHROPIC_API_KEY=your_key_here
export OPENAI_API_KEY=your_key_here
```

### 3. Configure TinyClaw

Edit `~/.tinyclaw/settings.json`:

```json
{
  "agents": {
    "coder": {
      "name": "Code Assistant",
      "provider": "opencode",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/coder"
    }
  }
}
```

### 4. Available Models

- `sonnet` - Claude Sonnet 4.5 (default)
- `opus` - Claude Opus 4.6
- `opencode/claude-sonnet-4-5` - Full provider/model format
- `opencode/kimi-k2.5` - Moonshot AI
- `opencode/gemini-3-pro` - Google
- See all: `opencode models`

## How It Works

When TinyClaw invokes an OpenCode agent:

1. Directory Setup: Creates `.opencode/` with skills symlinked
2. Agent Config: Generates per-agent `opencode.json` 
3. Invocation: Runs `opencode run --agent <agentId> --format json`
4. Response Parsing: Extracts text from JSONL output
5. Conversation Continuity: Uses `-c` flag to resume sessions

## Using Skills

Skills in `.agents/skills/` are automatically available to OpenCode agents:

- `agent-browser` - Browser automation
- `imagegen` - Image generation
- `schedule` - Cron scheduling
- `send-user-message` - Proactive messaging
- `skill-creator` - Create new skills

Skills are loaded via the `skill` tool when agents need them.

## Commands Reference

### Interactive Mode

```bash
opencode                    # Start TUI
opencode --agent coder      # Use specific agent
```

### Non-Interactive Mode (what TinyClaw uses)

```bash
opencode run "Your message here"
opencode run --agent coder --model sonnet "Fix the bug"
opencode run -c "Continue from last session"
```

### Server Mode

```bash
opencode serve              # Headless server
opencode web                # Server with web UI
```

## Migration from Claude Code

If you were using Claude Code CLI:

1. Install OpenCode: `curl -fsSL https://opencode.ai/install | bash`
2. Authenticate: `opencode auth login`
3. Change agent provider from `'anthropic'` to `'opencode'`
4. No other changes needed - skills and AGENTS.md work the same

## Differences from Claude Code

| Feature | Claude Code | OpenCode |
|---------|-------------|----------|
| Config format | `.claude/CLAUDE.md` | `opencode.json` |
| Skills location | `.claude/skills/` | `.opencode/skills/` |
| Invocation | `claude -p` | `opencode run` |
| Agent system | Custom (TinyClaw) | Built-in |
| Web UI | No | Yes (`opencode web`) |
| Server mode | No | Yes (`opencode serve`) |

## Troubleshooting

### Agent not found

Ensure the agent ID in `settings.json` matches an agent defined in `opencode.json`.

### Skills not loading

Check that `.opencode/skills/` exists and contains SKILL.md files with proper frontmatter.

### Model errors

Run `opencode models` to see available models for your authenticated providers.

### Conversation not continuing

OpenCode uses session-based conversations. The `-c` flag resumes the last session for the current directory.

## Additional Resources

- [OpenCode Docs](https://opencode.ai/docs/)
- [OpenCode Agents](https://opencode.ai/docs/agents/)
- [OpenCode Skills](https://opencode.ai/docs/skills/)
- [OpenCode GitHub](https://github.com/anomalyco/opencode)

## See Also

- [CLI Guide](CLI.md) - Using TinyClaw from the command line
- [5-Agent Squad](5-AGENT-SQUAD.md) - Multi-agent collaboration setup
- [AGENTS.md](../AGENTS.md) - General agent documentation
