# Queue System

TinyAGI uses a SQLite-backed queue (`tinyagi.db`) to coordinate message processing across multiple channels and agents. Messages are stored in a `messages` table (incoming) and `responses` table (outgoing), with atomic transactions for reliable delivery.

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Message Channels                         │
│         (Discord, Telegram, WhatsApp, Heartbeat)            │
└────────────────────┬────────────────────────────────────────┘
                     │ enqueueMessage()
                     ↓
┌─────────────────────────────────────────────────────────────┐
│                   ~/.tinyagi/tinyagi.db                     │
│                                                              │
│  messages table                    responses table           │
│  status: pending → processing →   status: pending → acked   │
│          completed / dead                                    │
│                                                              │
└────────────────────┬────────────────────────────────────────┘
                     │ Queue Processor
                     ↓
┌─────────────────────────────────────────────────────────────┐
│              Parallel Processing by Agent                    │
│                                                              │
│  Agent: coder        Agent: writer       Agent: assistant   │
│  ┌──────────┐       ┌──────────┐        ┌──────────┐       │
│  │ Message 1│       │ Message 1│        │ Message 1│       │
│  │ Message 2│ ...   │ Message 2│  ...   │ Message 2│ ...   │
│  │ Message 3│       │          │        │          │       │
│  └────┬─────┘       └────┬─────┘        └────┬─────┘       │
│       │                  │                     │            │
└───────┼──────────────────┼─────────────────────┼────────────┘
        ↓                  ↓                     ↓
   claude CLI         claude CLI             claude CLI
  (workspace/coder)  (workspace/writer)  (workspace/assistant)
```

## Database Schema

The queue lives in `~/.tinyagi/tinyagi.db` (SQLite, WAL mode).

### Messages Table (incoming queue)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-incrementing primary key |
| `message_id` | TEXT | Unique message identifier (nanoid with prefix) |
| `channel` | TEXT | Source channel (discord, telegram, web, etc.) |
| `sender` | TEXT | Sender display name |
| `sender_id` | TEXT | Sender platform ID |
| `message` | TEXT | Message content |
| `agent` | TEXT | Target agent (null = default) |
| `from_agent` | TEXT | Source agent (internal messages) |
| `status` | TEXT | `pending` → `processing` → `completed` / `dead` |
| `retry_count` | INTEGER | Number of failed attempts |
| `last_error` | TEXT | Last error message |
| `created_at` | INTEGER | Timestamp (ms) |
| `updated_at` | INTEGER | Timestamp (ms) |

### Responses Table (outgoing queue)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-incrementing primary key |
| `message_id` | TEXT | Original message ID |
| `channel` | TEXT | Target channel for delivery |
| `sender` | TEXT | Original sender |
| `sender_id` | TEXT | Original sender platform ID |
| `message` | TEXT | Response content |
| `original_message` | TEXT | Original user message |
| `agent` | TEXT | Agent that generated the response |
| `files` | TEXT | JSON array of file paths |
| `metadata` | TEXT | JSON metadata from hooks |
| `status` | TEXT | `pending` → `acked` |
| `created_at` | INTEGER | Timestamp (ms) |
| `acked_at` | INTEGER | Timestamp when channel client acknowledged |

### Chat Messages Table (team chat room persistence)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-incrementing primary key |
| `team_id` | TEXT | Team that owns this chat room |
| `from_agent` | TEXT | Agent that posted the message |
| `message` | TEXT | Message content |
| `created_at` | INTEGER | Timestamp (ms) |

This table is append-only and grows indefinitely. All chat room delivery happens through the messages table via `postToChatRoom()`.

### Agent Messages Table (per-agent history)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-incrementing primary key |
| `agent_id` | TEXT | Agent identifier |
| `role` | TEXT | `user` or `assistant` |
| `channel` | TEXT | Source channel |
| `sender` | TEXT | Sender name |
| `message_id` | TEXT | Related message ID |
| `content` | TEXT | Message content |
| `created_at` | INTEGER | Timestamp (ms) |

This table is append-only and grows indefinitely. Provides complete agent interaction history.

## Message IDs

All message IDs use nanoid (8 lowercase alphanumeric chars) with a descriptive prefix:

| Prefix | Source |
|--------|--------|
| `api_` | Messages from the REST API |
| `discord_` | Messages from Discord |
| `telegram_` | Messages from Telegram |
| `whatsapp_` | Messages from WhatsApp |
| `internal_` | Agent-to-agent DMs (teammate mentions) |
| `chat_` | Chat room broadcasts to individual agents |
| `chatroom_` | Chat room posts via API |
| `chatroom_batch_` | Batched chat room messages |
| `proactive_` | Proactive outgoing messages |

Example: `internal_a1b2c3d4`, `api_x9y8z7w6`

## Message Flow

### 1. Incoming Message

A channel client receives a message and enqueues it:

```typescript
enqueueMessage({
    channel: 'discord',
    sender: 'Alice',
    senderId: 'user_12345',
    message: '@coder fix the authentication bug',
    messageId: genId('discord'),
});
```

This inserts a row into `messages` with `status = 'pending'` and emits a `message:enqueued` event for instant pickup.

### 2. Processing

The queue processor picks up messages via two mechanisms:

- **Event-driven**: `queueEvents.on('message:enqueued')` — instant for in-process messages
- **Polling fallback**: Every 5s — catches cross-process messages from channel clients

For each pending agent, the processor claims all pending messages at once via `claimAllPendingMessages(agentId)`:

```typescript
const msgs = claimAllPendingMessages('coder');
// Sets status = 'processing' for all claimed messages
```

The first message becomes the primary message; the rest are batched as additional context and delivered together in a single agent invocation.

### 3. Agent Processing

Each agent has its own promise chain for sequential processing:

```typescript
// Messages to same agent = sequential (preserve conversation order)
agentChain: msg1 → msg2 → msg3

// Different agents = parallel (don't block each other)
@coder:     msg1 ──┐
@writer:    msg1 ──┼─→ All run concurrently
@assistant: msg1 ──┘
```

### 4. Response

After the AI responds, the response is streamed to the user immediately via `streamResponse()`, which enqueues it in the responses table. The original message is marked `status = 'completed'`.

If the response contains `[@teammate: message]` tags, those are extracted and enqueued as new internal messages — flat DMs with no conversation tracking.

### 5. Channel Delivery

Channel clients poll for responses:

```typescript
const responses = getResponsesForChannel('discord');
for (const response of responses) {
    await sendToUser(response);
    ackResponse(response.id);  // marks status = 'acked'
}
```

## Error Handling & Retry

### Retry Logic

When processing fails, `failMessage()` increments `retry_count`:

```
Attempt 1: fails → retry_count = 1, status = 'pending'
Attempt 2: fails → retry_count = 2, status = 'pending'
...
Attempt 5: fails → retry_count = 5, status = 'dead'
```

Messages that exhaust retries (default: 5) are marked `status = 'dead'`.

### Dead-Letter Management

```
GET    /api/queue/dead           → list dead messages
POST   /api/queue/dead/:id/retry → reset retry count, re-queue
DELETE /api/queue/dead/:id       → permanently delete
```

### Stale Message Recovery

Messages stuck in `processing` (e.g., from a crash) are automatically recovered every minute:

```typescript
recoverStaleMessages(10 * 60 * 1000);  // anything processing > 10 min
```

## Real-Time Events

The queue processor emits events via an in-memory listener system. The API server broadcasts these over SSE at `GET /api/events/stream`.

| Event | Description |
|-------|-------------|
| `message_received` | New message picked up |
| `agent_routed` | Message routed to agent |
| `chain_step_start` | Agent begins processing |
| `chain_step_done` | Agent finished (includes response) |
| `chain_handoff` | Agent mentions a teammate |
| `response_ready` | Response enqueued for delivery |
| `processor_start` | Queue processor started |

## API Endpoints

The API server runs on port 3777 (configurable via `TINYAGI_API_PORT`):

| Endpoint | Description |
|----------|-------------|
| `POST /api/message` | Enqueue a message |
| `GET /api/queue/status` | Queue depth (pending, processing, dead) |
| `GET /api/queue/agents` | Per-agent queue depth (pending, processing) |
| `GET /api/responses` | Recent responses |
| `GET /api/queue/dead` | Dead messages |
| `POST /api/queue/dead/:id/retry` | Retry a dead message |
| `DELETE /api/queue/dead/:id` | Delete a dead message |
| `GET /api/events/stream` | SSE event stream |

## Maintenance

Periodic cleanup tasks run every 60 seconds:

- **Stale message recovery**: Messages stuck in `processing` > 10 min reset to `pending`
- **Acked response pruning**: Responses acked > 24h ago are deleted
- **Completed message pruning**: Messages completed > 24h ago are deleted

## See Also

- [MESSAGE-PATTERNS.md](MESSAGE-PATTERNS.md) - Team message patterns (DM, fan-out, chat room)
- [AGENTS.md](AGENTS.md) - Agent configuration and management
- [TEAMS.md](TEAMS.md) - Team collaboration and message passing
- [packages/core/src/queues.ts](../packages/core/src/queues.ts) - Queue implementation
- [packages/main/src/index.ts](../packages/main/src/index.ts) - Queue processor entry point
- [packages/teams/src/conversation.ts](../packages/teams/src/conversation.ts) - Team message routing
