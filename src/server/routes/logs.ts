import { Hono } from 'hono';
import { readLogEntries } from '../../lib/logging';

const app = new Hono();

// GET /api/logs
app.get('/api/logs', (c) => {
    const limit = parseInt(c.req.query('limit') || '100', 10);
    const source = c.req.query('source')?.split(',').map(item => item.trim()).filter(Boolean) ?? [];
    const level = c.req.query('level') || undefined;
    const channel = c.req.query('channel') || undefined;
    const agentId = c.req.query('agentId') || undefined;
    const messageId = c.req.query('messageId') || undefined;
    const conversationId = c.req.query('conversationId') || undefined;
    const search = c.req.query('search') || undefined;

    return c.json({
        entries: readLogEntries({
            limit,
            source,
            level,
            channel,
            agentId,
            messageId,
            conversationId,
            search,
        }),
    });
});

export default app;
