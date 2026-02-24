# Launching Multiple Agents with OpenCode

This guide shows how to launch 5 agents using OpenCode as the provider to solve a problem collaboratively.

## Quick Setup (5 Agents)

### Step 1: Configure Agents in settings.json

Edit `~/.tinyclaw/settings.json`:

```json
{
  "workspace": {
    "path": "/Users/me/tinyclaw-workspace",
    "name": "tinyclaw-workspace"
  },
  "agents": {
    "architect": {
      "name": "System Architect",
      "provider": "opencode",
      "model": "opencode/claude-opus-4-6",
      "working_directory": "/Users/me/tinyclaw-workspace/architect"
    },
    "coder": {
      "name": "Code Implementer",
      "provider": "opencode",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/coder"
    },
    "reviewer": {
      "name": "Code Reviewer",
      "provider": "opencode",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/reviewer"
    },
    "tester": {
      "name": "Test Engineer",
      "provider": "opencode",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/tester"
    },
    "writer": {
      "name": "Documentation Writer",
      "provider": "opencode",
      "model": "sonnet",
      "working_directory": "/Users/me/tinyclaw-workspace/writer"
    }
  },
  "teams": {
    "squad": {
      "name": "Full Stack Squad",
      "agents": ["architect", "coder", "reviewer", "tester", "writer"],
      "leader_agent": "architect"
    }
  }
}
```

### Step 2: Restart TinyClaw

TinyClaw will automatically create the agent workspaces on restart:

```bash
./tinyclaw.sh restart
```

Or if using no-tmux mode:

```bash
./tinyclaw.sh stop
./tinyclaw.sh start --no-tmux
```

### Step 3: Launch the Squad

**Via CLI:**
```bash
# Send a message to the entire squad (routes to leader: @architect)
./tinyclaw.sh send "@squad Build a REST API for user authentication with JWT tokens"

# Watch responses
./tinyclaw.sh receive --wait 60

# Or use chat to send and wait in one command
./tinyclaw.sh chat "@squad Build a REST API for user authentication"
```

**Direct from terminal with visualizer:**
```bash
# Watch the collaboration in real-time
./tinyclaw.sh team visualize squad
```

## How Collaboration Works

When you send a message to a team, the following happens:

1. User sends: "@squad Build a REST API..."
2. TinyClaw routes to the leader agent (@architect)
3. @architect responds with a design and mentions teammates
4. Each mentioned teammate receives the message and responds
5. All responses are aggregated and returned to you

### Example Message Flow

**From @architect:**
```
I have designed the API structure with 3 endpoints: 
- POST /auth/login
- POST /auth/register  
- POST /auth/refresh

[@coder: Please implement these endpoints in Express.js]
[@reviewer: Review the design for security issues]
```

**From @coder:**
```
Implemented all 3 endpoints with JWT token generation.
Added input validation and rate limiting.

[@reviewer: Please review the implementation]
[@tester: Please write unit tests for the endpoints]
[@writer: The API is ready for documentation]
```

### Agent Roles

| Agent | Responsibility | When They Act |
|-------|---------------|---------------|
| @architect | System design, API structure, database schema | First - sets the foundation |
| @coder | Implementation, code writing, bug fixes | After design is ready |
| @reviewer | Code review, security checks, best practices | After code is written |
| @tester | Test cases, validation, edge case handling | In parallel with review |
| @writer | Documentation, README, API docs | After everything is stable |

## Available Commands

### Sending Messages

```bash
# Send to team (routes to leader)
./tinyclaw.sh send "@squad fix the auth bug"

# Send to specific agent
./tinyclaw.sh send "@coder implement login"

# Send and wait for response
./tinyclaw.sh chat "@squad build an API"
```

### Receiving Responses

```bash
# Check for pending responses (non-blocking)
./tinyclaw.sh receive

# Wait for responses (blocking with timeout)
./tinyclaw.sh receive --wait 60
```

### Monitoring

```bash
# Watch real-time team activity
./tinyclaw.sh team visualize squad

# View logs
./tinyclaw.sh logs queue

# Check status
./tinyclaw.sh status
```

## Advanced Usage

### Sequential Execution

If you want agents to work in sequence rather than parallel:

```bash
# Step 1: Design only
./tinyclaw.sh chat "@architect Design a microservices architecture"

# Step 2: After design is done, implement
./tinyclaw.sh chat "@coder Implement based on the architecture"

# Step 3: Review
./tinyclaw.sh chat "@reviewer Review the implementation"
```

### Parallel Fan-Out

To have all agents work simultaneously on different aspects:

```bash
./tinyclaw.sh send "@squad We need to refactor the database layer:
- @architect: Design the new schema
- @coder: Write migration scripts  
- @reviewer: Review for data integrity
- @tester: Plan migration tests
- @writer: Document the new schema"

# Then wait for all responses
./tinyclaw.sh receive --wait 120
```

## Viewing Results

### Chat History

Team conversations are saved to:
```
~/.tinyclaw/chats/squad/2026-02-24_14-30-00.md
```

View with:
```bash
cat ~/.tinyclaw/chats/squad/*.md
```

### Real-Time Logs

```bash
# Watch queue processing
./tinyclaw.sh logs queue

# Filter by agent
./tinyclaw.sh logs queue | grep "architect"
```

## Tips for 5-Agent Collaboration

1. **Start with the leader** - The leader (@architect) should provide clear direction
2. **Use specific mentions** - `[@coder: implement auth middleware]` not just `@coder`
3. **Keep messages focused** - 2-3 sentences to avoid context overflow
4. **Wait for responses** - Don't re-mention agents who are still processing
5. **Text outside brackets is shared** - Text not in `[@agent: ...]` tags goes to all mentioned agents

## Troubleshooting

### Agents not collaborating

Check that:
- All 5 agents are in the same team in `settings.json`
- Team `leader_agent` is set correctly
- Agents have the `opencode` provider

### One agent not responding

```bash
# Check agent status
./tinyclaw.sh agent show <agent_id>

# Reset if needed
./tinyclaw.sh agent reset <agent_id>
```

### Reset all agents

```bash
./tinyclaw.sh reset architect coder reviewer tester writer
```

## Alternative: Direct Agent Control

If you do not want automatic collaboration, skip the team configuration and message agents directly:

```json
{
  "agents": {
    "architect": { "provider": "opencode", ... },
    "coder": { "provider": "opencode", ... },
    "reviewer": { "provider": "opencode", ... },
    "tester": { "provider": "opencode", ... },
    "writer": { "provider": "opencode", ... }
  }
}
```

Then manually orchestrate:
```bash
./tinyclaw.sh chat "@architect Design the system"
./tinyclaw.sh chat "@coder Implement based on the design"
./tinyclaw.sh chat "@reviewer Review the code"
```

## See Also

- [CLI Guide](CLI.md) - Complete CLI usage documentation
- [OpenCode Integration](OPENCODE.md) - OpenCode-specific documentation
- [AGENTS.md](../AGENTS.md) - General agent documentation
