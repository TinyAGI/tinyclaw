---
name: schedule
description: "Create, list, and delete scheduled tasks (recurring or one-time) that send messages to agents. Use when the user wants to: schedule a recurring task for an agent, set up a one-time future task, list existing scheduled tasks, delete or remove a scheduled task, or automate periodic agent work (reports, checks, reminders, syncs)."
---

# Schedule Skill

Manage scheduled tasks that deliver messages to agents via the tinyclaw API. Schedules can be **recurring** (cron-based) or **one-time** (fire once at a specific date/time). Each schedule enqueues a routed message (`@agent_id <task>`) that the queue processor picks up and invokes.

Schedules are persisted to `~/.tinyclaw/schedules.json` and run in-process via the `croner` library — no system crontab required.

## API Endpoints

Schedules are managed via REST endpoints on the API server:

- `GET /api/schedules[?agent=ID]` — list schedules
- `POST /api/schedules` — create a schedule
- `PUT /api/schedules/:id` — update a schedule
- `DELETE /api/schedules/:id` — delete a schedule

## Shell CLI

Use the bundled CLI `scripts/schedule.sh` for shell-based operations.

### Create a recurring schedule

```bash
scripts/schedule.sh create \
  --cron "EXPR" \
  --agent AGENT_ID \
  --message "Task context for the agent" \
  [--channel CHANNEL] \
  [--sender SENDER] \
  [--label LABEL]
```

- `--cron` — 5-field cron expression (required for recurring). Examples: `"0 9 * * *"` (daily 9am), `"*/30 * * * *"` (every 30 min), `"0 0 * * 1"` (weekly Monday midnight).
- `--agent` — Target agent ID (required). Must match an agent configured in settings.json.
- `--message` — The task context / prompt sent to the agent (required).
- `--channel` — Channel name in the queue message (default: `schedule`).
- `--sender` — Sender name in the queue message (default: `Scheduler`).
- `--label` — Unique label to identify this schedule (default: auto-generated).

### Create a one-time schedule (via API)

One-time schedules are created via the REST API by passing `runAt` (ISO 8601 datetime) instead of `cron`:

```bash
curl -X POST http://localhost:3777/api/schedules \
  -H "Content-Type: application/json" \
  -d '{
    "runAt": "2026-03-20T09:00:00.000Z",
    "agentId": "coder",
    "message": "Deploy the staging build",
    "label": "staging-deploy"
  }'
```

One-time schedules automatically disable themselves after firing.

### List schedules

```bash
scripts/schedule.sh list [--agent AGENT_ID]
```

Lists all tinyclaw schedules. Optionally filter by `--agent` to show only schedules targeting a specific agent.

### Delete a schedule

```bash
scripts/schedule.sh delete --label LABEL
scripts/schedule.sh delete --all
```

Delete a specific schedule by label, or delete all tinyclaw schedules.

## Workflow

1. Confirm the target agent ID exists (check `settings.json` or ask the user).
2. Determine recurring vs one-time:
   - **Recurring**: determine the cron expression from the user's description (e.g., "every morning" -> `"0 9 * * *"`).
   - **One-time**: determine the target date/time and convert to ISO 8601 format.
3. Compose a clear task message — this is the prompt the agent will receive.
4. Run `scripts/schedule.sh create` (recurring) or use the API (one-time) with the parameters.
5. Verify with `scripts/schedule.sh list`.

## Cron expression quick reference

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

| Pattern           | Meaning                    |
|-------------------|----------------------------|
| `0 9 * * *`       | Daily at 9:00 AM           |
| `0 9 * * 1-5`     | Weekdays at 9:00 AM        |
| `*/15 * * * *`    | Every 15 minutes           |
| `0 */2 * * *`     | Every 2 hours              |
| `0 0 * * 0`       | Weekly on Sunday midnight  |
| `0 0 1 * *`       | Monthly on the 1st         |
| `30 8 * * 1`      | Monday at 8:30 AM          |

## Examples

### Daily report

```bash
scripts/schedule.sh create \
  --cron "0 9 * * *" \
  --agent analyst \
  --message "Generate the daily metrics report and post a summary" \
  --label daily-report
```

### Periodic health check

```bash
scripts/schedule.sh create \
  --cron "*/30 * * * *" \
  --agent devops \
  --message "Run health checks on all services and report any issues" \
  --label health-check
```

### One-time deployment task

```bash
curl -X POST http://localhost:3777/api/schedules \
  -H "Content-Type: application/json" \
  -d '{"runAt":"2026-03-20T14:00:00.000Z","agentId":"devops","message":"Deploy v2.1 to production","label":"prod-deploy-v21"}'
```

### List and clean up

```bash
# See all schedules
scripts/schedule.sh list

# See only schedules for @coder
scripts/schedule.sh list --agent coder

# Remove one
scripts/schedule.sh delete --label health-check

# Remove all
scripts/schedule.sh delete --all
```

## How it works

- Schedules are persisted in `~/.tinyclaw/schedules.json`.
- The server runs an in-process cron scheduler (using `croner`) — no system crontab needed.
- When a schedule fires, it directly enqueues a message in the SQLite queue.
- The queue processor picks up the message and invokes the target agent, exactly like a message from any channel.
- One-time schedules (`runAt`) auto-disable after firing.
- Responses are stored in the SQLite queue and delivered by channel clients.

## TinyOffice UI

Schedules can also be managed via the **Schedule** tab on each agent's detail page in TinyOffice. The UI provides a calendar view showing upcoming scheduled events and a form to create new schedules (recurring or one-time) without writing cron expressions.
