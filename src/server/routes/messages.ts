import { Hono } from 'hono';
import { emitEvent } from '../../lib/events';
import { createLogger, excerptText } from '../../lib/logging';
import { enqueueMessage } from '../../lib/db';

const app = new Hono();
const logger = createLogger({ runtime: 'api', source: 'api', component: 'messages-route' });

// POST /api/message
app.post('/api/message', async (c) => {
    const body = await c.req.json();
    const { message, agent, sender, senderId, channel, files, messageId: clientMessageId } = body as {
        message?: string; agent?: string; sender?: string; senderId?: string;
        channel?: string; files?: string[]; messageId?: string;
    };

    if (!message || typeof message !== 'string') {
        return c.json({ error: 'message is required' }, 400);
    }

    const resolvedChannel = channel || 'api';
    const resolvedSender = sender || 'API';
    const messageId = clientMessageId || `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Append channel and sender context as a signature
    const fullMessage = (channel && sender) ? `${message}\n\n— ${sender} via ${channel}` : message;

    enqueueMessage({
        channel: resolvedChannel,
        sender: resolvedSender,
        senderId: senderId || undefined,
        message: fullMessage,
        messageId,
        agent: agent || undefined,
        files: files && files.length > 0 ? files : undefined,
    });

    logger.info({
        channel: resolvedChannel,
        sender: resolvedSender,
        agentId: agent || undefined,
        messageId,
        excerpt: excerptText(message, 120),
    }, 'Message enqueued');
    emitEvent('message_enqueued', {
        messageId,
        agent: agent || null,
        channel: resolvedChannel,
        sender: resolvedSender,
        message: excerptText(message, 120),
    });

    return c.json({ ok: true, messageId });
});

export default app;
