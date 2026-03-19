# Troubleshooting

Common issues and solutions for TinyAGI.

## Installation Issues

### Bash version error on macOS

If you see:

```text
Error: This script requires bash 4.0 or higher (you have 3.2.57)
```

macOS ships with bash 3.2 by default. Install a newer version:

```bash
# Install bash 5.x via Homebrew
brew install bash

# Add to your PATH (add this to ~/.zshrc or ~/.bash_profile)
export PATH="/opt/homebrew/bin:$PATH"

# Or run directly with the new bash
tinyagi start
```

### Node.js dependencies not installing

```bash
# Clear npm cache and reinstall
rm -rf node_modules package-lock.json
npm cache clean --force
PUPPETEER_SKIP_DOWNLOAD=true npm install
```

## Channel Issues

### WhatsApp not connecting

```bash
# Check logs
tinyagi logs whatsapp

# Reset WhatsApp authentication
tinyagi channels reset whatsapp
tinyagi restart
```

**Common causes:**

- QR code expired (scan within 60 seconds)
- Session files corrupted
- Multiple WhatsApp Web sessions active

**Solution:**

1. Delete session: `rm -rf .tinyagi/whatsapp-session/`
2. Restart: `tinyagi restart`
3. Scan new QR code immediately

### Discord bot not responding

```bash
# Check logs
tinyagi logs discord

# Update Discord bot token
tinyagi setup
```

**Checklist:**

- ✅ Bot token is correct
- ✅ "Message Content Intent" is enabled in Discord Developer Portal
- ✅ Bot has permissions to read/send messages
- ✅ Bot is added to your server

### Telegram bot not responding

```bash
# Check logs
tinyagi logs telegram

# Update Telegram bot token
tinyagi setup
```

**Common issues:**

- Bot token is invalid or revoked
- Bot wasn't started (send `/start` to your bot first)
- Bot removed from group

### QR code not showing

```bash
# Attach to tmux to see the QR code
tmux attach -t tinyagi
```

The QR code appears in the WhatsApp pane. If it's not visible:

1. Check if WhatsApp is enabled: `cat .tinyagi/settings.json | jq '.channels.enabled'`
2. Check WhatsApp process: `pgrep -f whatsapp-client.ts`
3. View logs: `tail -f .tinyagi/logs/whatsapp.log`

## Queue Issues

### Messages not processing

```bash
# Check queue processor status
tinyagi status

# Check queue status via API
curl http://localhost:3777/api/queue/status | jq

# View queue logs
tinyagi logs queue
```

**Checklist:**

- ✅ Queue processor is running
- ✅ Claude Code CLI is installed: `claude --version`
- ✅ No dead messages: `curl http://localhost:3777/api/queue/dead | jq`

### Messages stuck in processing

Messages stuck in `processing` state are automatically recovered after 10
minutes. To force recovery:

```bash
# Restart TinyAGI (triggers stale message recovery on startup)
tinyagi restart
```

### Responses not being sent

```bash
# Check responses via API
curl http://localhost:3777/api/responses | jq

# Check channel client logs
tinyagi logs discord
tinyagi logs telegram
tinyagi logs whatsapp
```

## Model / Provider Issues

### Model or provider change has no effect

If `tinyagi model` or `tinyagi provider` doesn't seem to change the model your agents use:

1. **Check what agents actually run with:**

   ```bash
   tinyagi model
   # or
   tinyagi provider
   ```

   Both show the global default **and** per-agent breakdown. If an agent still shows the old model, the change didn't propagate.

2. **Agents override the global default.** When agents exist in `settings.json`, each agent's own `provider`/`model` fields are used — the global `models` section is only a fallback when no agents are configured.

3. **Use `--model` with provider switches.** `tinyagi provider <name>` (without `--model`) only changes the global default and does **not** update agents. Add `--model` to propagate:

   ```bash
   tinyagi provider openai --model gpt-5.3-codex
   ```

4. **Override a single agent:** Use `tinyagi agent provider` for per-agent control:

   ```bash
   tinyagi agent provider coder anthropic --model opus
   ```

5. **Verify settings file is valid JSON:**

   ```bash
   jq . .tinyagi/settings.json
   ```

## Agent Issues

### Agent not found

If you see "Agent 'xyz' not found":

1. Check agent exists:

   ```bash
   tinyagi agent list
   ```

2. Verify agent ID is lowercase and matches exactly:

   ```bash
   cat .tinyagi/settings.json | jq '.agents'
   ```

3. Check settings file is valid JSON:

   ```bash
   cat .tinyagi/settings.json | jq
   ```

### Wrong agent responding

If messages go to the wrong agent:

1. **Check routing prefix:** Must be `@agent_id` with space after
   - ✅ Correct: `@coder fix the bug`
   - ❌ Wrong: `@coderfix the bug` (no space)
   - ❌ Wrong: `@ coder fix the bug` (space before agent_id)

2. **Verify agent exists:**

   ```bash
   tinyagi agent show coder
   ```

3. **Check logs:**

   ```bash
   tail -f .tinyagi/logs/queue.log | grep "Routing"
   ```

### Conversation not resetting

If `@agent /reset` doesn't work:

1. Check reset flag exists:

   ```bash
   ls ~/tinyagi-workspace/{agent_id}/reset_flag
   ```

2. Send a new message to trigger reset (flag is checked before each message)

3. Remember: Reset is one-time only
   - First message after reset: Fresh conversation
   - Subsequent messages: Continues conversation

### CLI not found

If agent can't execute (error: `command not found`):

**For Anthropic agents:**

```bash
# Check Claude CLI is installed
claude --version

# Install if missing
# Visit: https://claude.com/claude-code
```

**For OpenAI agents:**

```bash
# Check Codex CLI is installed
codex --version

# Authenticate if needed
codex login
```

### Workspace issues

If agents aren't being created:

1. Check workspace path:

   ```bash
   cat .tinyagi/settings.json | jq '.workspace.path'
   ```

2. Verify workspace exists:

   ```bash
   ls ~/tinyagi-workspace/
   ```

3. Check permissions:

   ```bash
   ls -la ~/tinyagi-workspace/
   ```

4. Manually create if needed:

   ```bash
   mkdir -p ~/tinyagi-workspace
   ```

### Templates not copying

If new agents don't have `.claude/`, `heartbeat.md`, or `AGENTS.md`:

1. Check templates exist:

   ```bash
   ls -la ~/.tinyagi/{.claude,heartbeat.md,AGENTS.md}
   ```

2. Run setup to create templates:

   ```bash
   tinyagi setup
   ```

3. Manually copy if needed:

   ```bash
   cp -r .claude ~/.tinyagi/
   cp heartbeat.md ~/.tinyagi/
   cp AGENTS.md ~/.tinyagi/
   ```

## Update Issues

### Update check failing

If you see "Could not fetch latest version":

1. **Check internet connection:**

   ```bash
   curl -I https://api.github.com
   ```

2. **Check GitHub API rate limit:**

   ```bash
   curl https://api.github.com/rate_limit
   ```

3. **Disable update checks:**

   ```bash
   export TINYAGI_SKIP_UPDATE_CHECK=1
   tinyagi start
   ```

### Update download failing

If bundle download fails during update:

1. **Check release exists:**
   - Visit: <https://github.com/TinyAGI/tinyagi/releases>
   - Verify bundle file is attached

2. **Manual update:**

   ```bash
   # Download bundle manually
   wget https://github.com/TinyAGI/tinyagi/releases/latest/download/tinyagi-bundle.tar.gz

   # Extract to temp directory
   mkdir temp-update
   tar -xzf tinyagi-bundle.tar.gz -C temp-update

   # Backup current installation
   cp -r ~/tinyagi ~/.tinyagi/backups/manual-backup-$(date +%Y%m%d)

   # Replace files
   cp -r temp-update/tinyagi/* ~/tinyagi/
   ```

### Rollback after failed update

If update breaks TinyAGI:

```bash
# Find your backup
ls ~/.tinyagi/backups/

# Restore from backup
BACKUP_DIR=$(ls -t ~/.tinyagi/backups/ | head -1)
cp -r ~/.tinyagi/backups/$BACKUP_DIR/* $HOME/tinyagi/

# Restart
tinyagi restart
```

## Performance Issues

### High CPU usage

```bash
# Check which process is using CPU
top -o cpu | grep -E 'claude|codex|node'
```

**Common causes:**

- Long-running AI tasks
- Stuck message processing
- Too many concurrent operations

**Solutions:**

- Wait for current task to complete
- Restart: `tinyagi restart`
- Reduce heartbeat frequency in settings

### High memory usage

```bash
# Check memory usage
ps aux | grep -E 'claude|codex|node' | awk '{print $4, $11}'
```

**Solutions:**

- Restart TinyAGI: `tinyagi restart`
- Reset conversations: `tinyagi reset`
- Clear old sessions: `rm -rf .tinyagi/whatsapp-session/.wwebjs_*`

### Slow message responses

1. **Check queue depth:**

   ```bash
   curl http://localhost:3777/api/queue/status | jq
   ```

2. **Monitor AI response time:**

   ```bash
   tail -f .tinyagi/logs/queue.log | grep "Response ready"
   ```

## Log Analysis

### Enable debug logging

```bash
# Set log level (in queue-processor.ts or channel clients)
export DEBUG=tinyagi:*

# Restart with debug logs
tinyagi restart
```

### Useful log patterns

**Find errors:**

```bash
grep -i error .tinyagi/logs/*.log
```

**Track message routing:**

```bash
grep "Routing" .tinyagi/logs/queue.log
```

**Monitor agent activity:**

```bash
tail -f .tinyagi/logs/queue.log | grep "agent:"
```

**Check heartbeat timing:**

```bash
grep "Heartbeat" .tinyagi/logs/heartbeat.log
```

## Still Having Issues?

1. **Check status:**

   ```bash
   tinyagi status
   ```

2. **View all logs:**

   ```bash
   tinyagi logs all
   ```

3. **Restart from scratch:**

   ```bash
   tinyagi stop
   rm -f .tinyagi/tinyagi.db
   tinyagi start
   ```

4. **Report issue:**
   - GitHub Issues: <https://github.com/TinyAGI/tinyagi/issues>
   - Include logs and error messages
   - Describe steps to reproduce

## Recovery Commands

Quick reference for common recovery scenarios:

```bash
# Full reset (preserves settings)
tinyagi stop
rm -f .tinyagi/tinyagi.db
rm -rf .tinyagi/channels/*
rm -rf .tinyagi/whatsapp-session/*
tinyagi start

# Complete reinstall
cd ~/tinyagi
./scripts/uninstall.sh
cd ..
rm -rf tinyagi
curl -fsSL https://raw.githubusercontent.com/TinyAGI/tinyagi/main/scripts/remote-install.sh | bash

# Reset single agent
tinyagi agent reset coder
tinyagi restart
```
