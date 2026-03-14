# Message Patterns

Team communication in TinyClaw uses flat message passing: agents communicate by enqueuing messages for each other through a shared SQLite queue. There is no central orchestrator and no conversation state — each message is independent.

## How it works

```
User: "@dev host an all hands meeting"
         │
         ▼
  ┌──────────────┐
  │   @manager   │  (team leader)
  │   responds   │
  └──┬───┬───┬───┘
     │   │   │
     │   │   └─── [@tester: share your testing update]
     │   └─────── [@reviewer: share your review status]
     └─────────── [@coder: share what you're working on]
                        │
              3 messages enqueued in the queue
              each processed by its own agent
```

1. User sends a message to a team (or an agent in a team)
2. The leader agent is invoked and responds
3. The response is streamed to the user immediately
4. Any `[@teammate: message]` tags in the response become new messages in the queue
5. The queue processor picks them up instantly via in-process events (or on the next poll cycle for cross-process messages)
6. Each agent processes its message via its own per-agent promise chain (parallel across agents)
7. Each agent's response is streamed to the user as soon as it's ready
8. If an agent's response mentions more teammates, those become new messages too

## Shared context

Text outside `[@agent: ...]` tags is treated as shared context and delivered to every mentioned agent. Agent-specific instructions go inside the tags.

```
We're doing a standup. Sprint ends Friday, 3 open bugs.
Reply with: (1) status (2) blockers (3) next step.

[@coder: Also list any PRs you have open.]
[@reviewer: Also flag any PRs waiting on you.]
[@tester: Also report test coverage for the auth module.]
```

Each agent receives the full shared context + their directed message.

## Message flow patterns

### Sequential handoff

One agent mentions one teammate. The chain continues linearly.

```
@manager → [@coder: fix the auth bug]
  │
  ▼
@coder → [@reviewer: please review my fix]
  │
  ▼
@reviewer → (no mentions, done)
```

### Fan-out

One agent mentions multiple teammates. All are invoked in parallel.

```
@manager → [@coder: ...] [@reviewer: ...] [@tester: ...]
  │
  ├── @coder   (processes independently)
  ├── @reviewer (processes independently)
  └── @tester  (processes independently)
```

### Backflow

Agents can message back to whoever mentioned them. The `[@manager: ...]` tag becomes a new message for manager.

```
@manager → [@coder: what's your status?]
  │
  ▼
@coder → [@manager: systems operational, no blockers]
  │
  ▼
@manager → (processes coder's response)
```

### Cross-talk

After a fan-out, agents can message each other directly.

```
@manager → [@coder: ...] [@reviewer: ...] [@tester: ...]
  │
  ├── @reviewer → [@coder: check the fail-open behavior]
  ├── @tester   → [@coder: here are the test results]
  └── @coder    → (no mentions)
       │
       ▼
  @coder gets two separate messages (processed sequentially):
    1. From @reviewer
    2. From @tester
```

## Chat room

Every team has a persistent chat room. Agents post to it using the `[#team_id: message]` tag. This is a broadcast channel for shared context, separate from directed `[@agent: message]` DMs.

### Posting

Agents post to the chat room explicitly:

```
[#dev: I've finished the auth refactor, tests passing]
```

### Delivery

Chat room messages are delivered as regular queued messages with the format:

```
[Chat room #dev — @coder]:
I fixed the auth bug in login.ts, changed the token validation logic.
```

When multiple chat room messages are pending for an agent, they're batched into a single invocation via `groupChatroomMessages()`.

### Storage

Chat room messages are persisted to the `chat_messages` table. This table is append-only and grows indefinitely.

## Agent message history

Every agent invocation (both user messages and assistant responses) is persisted to the `agent_messages` table. This provides a complete history of all agent interactions and grows indefinitely.
