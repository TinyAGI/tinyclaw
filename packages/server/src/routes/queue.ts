import { Hono } from 'hono';
import {
    Conversation, log,
    getQueueStatus, getRecentResponses, getResponsesForChannel,
    ackResponse, enqueueResponse,
    getDeadMessages, retryDeadMessage, deleteDeadMessage,
} from '@tinyclaw/core';

export function createQueueRoutes(conversations: Map<string, Conversation>) {
    const app = new Hono();

    // GET /api/queue/status
    app.get('/api/queue/status', (c) => {
        const status = getQueueStatus();
        return c.json({
            incoming: status.pending,
            processing: status.processing,
            completed: status.completed,
            dead: status.dead,
            outgoing: status.responsesPending,
            activeConversations: conversations.size,
        });
    });

    // GET /api/responses
    app.get('/api/responses', (c) => {
        const limit = parseInt(c.req.query('limit') || '20', 10);
        const rows = getRecentResponses(limit);
        return c.json(rows.map((r: any) => ({
            id: r.id,
            channel: r.channel,
            sender: r.sender,
            senderId: r.sender_id,
            message: r.message,
            originalMessage: r.original_message,
            timestamp: r.created_at,
            messageId: r.message_id,
            agent: r.agent,
            files: r.files ? JSON.parse(r.files) : undefined,
        })));
    });

    // GET /api/responses/pending?channel=whatsapp
    app.get('/api/responses/pending', (c) => {
        const channel = c.req.query('channel');
        if (!channel) return c.json({ error: 'channel query param required' }, 400);

        const rows = getResponsesForChannel(channel);
        return c.json(rows.map((r: any) => ({
            id: r.id,
            channel: r.channel,
            sender: r.sender,
            senderId: r.sender_id,
            message: r.message,
            originalMessage: r.original_message,
            messageId: r.message_id,
            agent: r.agent,
            files: r.files ? JSON.parse(r.files) : undefined,
            metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        })));
    });

    // POST /api/responses — enqueue a proactive outgoing message
    app.post('/api/responses', async (c) => {
        const body = await c.req.json();
        const { channel, sender, senderId, message, agent, files } = body as {
            channel?: string; sender?: string; senderId?: string;
            message?: string; agent?: string; files?: string[];
        };

        if (!channel || !sender || !message) {
            return c.json({ error: 'channel, sender, and message are required' }, 400);
        }

        const messageId = `proactive_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        enqueueResponse({
            channel,
            sender,
            senderId,
            message,
            originalMessage: '',
            messageId,
            agent,
            files: files && files.length > 0 ? files : undefined,
        });

        log('INFO', `[API] Proactive response enqueued for ${channel}/${sender}`);
        return c.json({ ok: true, messageId });
    });

    // POST /api/responses/:id/ack — acknowledge a response
    app.post('/api/responses/:id/ack', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        ackResponse(id);
        return c.json({ ok: true });
    });

    // GET /api/queue/dead
    app.get('/api/queue/dead', (c) => {
        const dead = getDeadMessages();
        return c.json(dead.map((m: any) => ({
            id: m.id,
            data: {
                channel: m.channel,
                sender: m.sender,
                senderId: m.sender_id,
                message: m.message,
                messageId: m.message_id,
                agent: m.agent,
            },
            failedReason: m.last_error,
            attemptsMade: m.retry_count,
            timestamp: m.created_at,
        })));
    });

    // POST /api/queue/dead/:id/retry
    app.post('/api/queue/dead/:id/retry', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        const ok = retryDeadMessage(id);
        if (!ok) return c.json({ error: 'dead message not found' }, 404);
        log('INFO', `[API] Dead message ${id} retried`);
        return c.json({ ok: true });
    });

    // DELETE /api/queue/dead/:id
    app.delete('/api/queue/dead/:id', (c) => {
        const id = parseInt(c.req.param('id'), 10);
        const ok = deleteDeadMessage(id);
        if (!ok) return c.json({ error: 'dead message not found' }, 404);
        log('INFO', `[API] Dead message ${id} deleted`);
        return c.json({ ok: true });
    });

    return app;
}
