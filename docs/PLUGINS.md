# Plugin Development Guide

TinyAGI supports plugins that can intercept messages, transform content, and react to system events. Plugins are auto-discovered from the `plugins/` folder inside your TinyAGI home directory.

## Quick Start

1. Create a plugin directory:

```bash
mkdir -p ~/.tinyagi/plugins/my-plugin
```

2. Create `index.js`:

```js
exports.activate = function(ctx) {
  ctx.log('INFO', 'My plugin loaded!');

  ctx.on('message_received', (event) => {
    ctx.log('INFO', `Message from ${event.sender} on ${event.channel}`);
  });
};

exports.hooks = {
  transformIncoming(message, ctx) {
    // Modify user messages before they reach the agent
    return message;
  },
  transformOutgoing(message, ctx) {
    // Modify agent responses before they're sent back
    return message;
  },
};
```

3. Restart TinyAGI. Your plugin loads automatically.

## Plugin Structure

```
~/.tinyagi/plugins/
└── my-plugin/
    └── index.js       # Required entry point (or index.ts compiled to JS)
```

A plugin module can export two things (both optional):

- **`activate(ctx)`** — Called once when the plugin loads. Use it to register event listeners and initialize state.
- **`hooks`** — An object with message transformation functions.

## Plugin Context

The `activate` function receives a `PluginContext` with these methods:

### `ctx.on(eventType, handler)`

Register an event listener. Use a specific event name or `'*'` for all events.

```js
ctx.on('message_received', (event) => {
  console.log(event.type);      // 'message_received'
  console.log(event.timestamp); // Unix ms
  console.log(event.sender);    // Event-specific data
});

ctx.on('*', (event) => {
  // Called for every event
});
```

### `ctx.log(level, message)`

Log a message prefixed with your plugin name. Levels: `DEBUG`, `INFO`, `WARN`, `ERROR`.

```js
ctx.log('INFO', 'Processing complete');
// Output: [plugin:my-plugin] Processing complete
```

### `ctx.getTinyAGIHome()`

Returns the resolved TinyAGI home directory path (e.g., `~/.tinyagi`).

## Hooks

Hooks let you transform messages as they flow through the system. Both hooks are optional and can be sync or async.

### `transformIncoming(message, ctx) → string | HookResult`

Runs **before** the message is sent to the agent. Use this to preprocess, filter, or enrich user input.

### `transformOutgoing(message, ctx) → string | HookResult`

Runs **after** the agent responds, **before** the response is sent to the channel. Use this to format, filter, or annotate output.

### Hook Context

Both hooks receive a `HookContext`:

| Field | Description |
|-------|-------------|
| `channel` | Channel name: `"telegram"`, `"discord"`, `"whatsapp"` |
| `sender` | User ID or name from the channel |
| `messageId` | Unique message identifier |
| `originalMessage` | The raw user message before any hook transformations |

### Return Values

Hooks can return either a plain string or a `HookResult` object:

```js
// Simple: just return the transformed text
transformOutgoing(message, ctx) {
  return message.toUpperCase();
}

// Advanced: return text with metadata
transformOutgoing(message, ctx) {
  return {
    text: message,
    metadata: { parseMode: 'markdown' },
  };
}
```

The `metadata` object supports `parseMode` and any custom keys you need.

### Hook Chaining

When multiple plugins define the same hook, they run in load order. Each plugin receives the output of the previous one, and metadata objects are merged.

## Events

Plugins can listen to system events via `ctx.on()`. Events are broadcast as the queue processor handles messages.

### Available Events

| Event | Description | Data Fields |
|-------|-------------|-------------|
| `message_received` | User message arrives in the queue | `channel`, `sender`, `message`, `messageId` |
| `message_enqueued` | Message added to the queue | `messageId`, `agent` |
| `agent_routed` | Message routed to an agent | `agentId`, `agentName`, `provider`, `model`, `isTeamRouted` |
| `chain_step_start` | Agent starts processing | `agentId`, `agentName`, `fromAgent` |
| `chain_step_done` | Agent finishes processing | `agentId`, `agentName`, `responseLength`, `responseText` |
| `response_ready` | Final response ready to send | `channel`, `sender`, `agentId`, `responseLength`, `responseText`, `messageId` |
| `team_chain_start` | Team conversation begins | `teamId`, `teamName`, `agents`, `leader` |
| `chain_handoff` | Agent hands off to teammate | `teamId`, `fromAgent`, `toAgent` |
| `team_chain_end` | Team conversation completes | `teamId`, `totalSteps`, `agents` |
| `processor_start` | Queue processor initializes | `agents`, `teams` |

All events include `type` (string) and `timestamp` (Unix ms) in addition to the fields listed above.

## Message Flow

```
User Message
     │
     ▼
 message_received event
     │
     ▼
 agent_routed event
     │
     ▼
 transformIncoming hooks ◄── Your plugin modifies input here
     │
     ▼
 chain_step_start event
     │
     ▼
 Agent processes message (Claude, Codex, etc.)
     │
     ▼
 chain_step_done event
     │
     ▼
 transformOutgoing hooks ◄── Your plugin modifies output here
     │
     ▼
 response_ready event
     │
     ▼
 Response sent to channel
```

## Examples

### Message Logger

```js
const fs = require('fs');
const path = require('path');

exports.activate = function(ctx) {
  const logFile = path.join(ctx.getTinyAGIHome(), 'plugins', 'logger', 'messages.log');

  ctx.on('message_received', (event) => {
    const line = `[${new Date(event.timestamp).toISOString()}] ${event.channel}/${event.sender}: ${event.message}\n`;
    fs.appendFileSync(logFile, line);
  });

  ctx.on('response_ready', (event) => {
    const line = `[${new Date(event.timestamp).toISOString()}] RESPONSE (${event.responseLength} chars): ${event.responseText?.substring(0, 100)}\n`;
    fs.appendFileSync(logFile, line);
  });
};
```

### Content Filter

```js
const BLOCKED_WORDS = ['spam', 'scam'];

exports.hooks = {
  transformIncoming(message, ctx) {
    for (const word of BLOCKED_WORDS) {
      if (message.toLowerCase().includes(word)) {
        return '[Message blocked by content filter]';
      }
    }
    return message;
  },
};
```

### Markdown Formatter

```js
exports.hooks = {
  transformOutgoing(message, ctx) {
    return {
      text: message,
      metadata: { parseMode: 'markdown' },
    };
  },
};
```

### Analytics Tracker

```js
exports.activate = function(ctx) {
  const stats = { received: 0, responded: 0 };

  ctx.on('message_received', () => { stats.received++; });
  ctx.on('response_ready', () => { stats.responded++; });

  // Log stats every 5 minutes
  setInterval(() => {
    ctx.log('INFO', `Stats: ${stats.received} received, ${stats.responded} responded`);
  }, 5 * 60 * 1000);
};
```

## Error Handling

Plugin errors are caught and logged — a failing plugin will never crash the queue processor. Both hook errors and event handler errors are isolated per-plugin.

## TypeScript

You can write plugins in TypeScript. Compile to JavaScript before loading:

```bash
cd ~/.tinyagi/plugins/my-plugin
npx tsc index.ts --outDir . --skipLibCheck
```

The plugin loader will pick up `index.js`. Types can be imported from the TinyAGI source if you have it available:

```ts
import type { PluginContext, Hooks, HookContext } from 'tinyagi/src/lib/plugins';
```
