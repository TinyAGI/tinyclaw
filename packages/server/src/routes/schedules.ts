import { Hono } from 'hono';
import { getSchedules, addSchedule, removeSchedule, updateSchedule } from '@tinyclaw/core';

const app = new Hono();

// GET /api/schedules — list all schedules, optionally filtered by agent
app.get('/api/schedules', (c) => {
    const agentId = c.req.query('agent');
    let schedules = getSchedules();
    if (agentId) {
        schedules = schedules.filter(s => s.agentId === agentId);
    }
    return c.json(schedules);
});

// POST /api/schedules — create a new schedule
app.post('/api/schedules', async (c) => {
    const body = await c.req.json() as {
        cron?: string;
        runAt?: string;
        agentId?: string;
        message?: string;
        label?: string;
        channel?: string;
        sender?: string;
        enabled?: boolean;
    };

    if ((!body.cron && !body.runAt) || !body.agentId || !body.message) {
        return c.json({ error: 'agentId, message, and either cron or runAt are required' }, 400);
    }

    try {
        const schedule = addSchedule({
            cron: body.cron,
            runAt: body.runAt,
            agentId: body.agentId,
            message: body.message,
            label: body.label,
            channel: body.channel,
            sender: body.sender,
            enabled: body.enabled,
        });
        return c.json({ ok: true, schedule });
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
    }
});

// PUT /api/schedules/:id — update a schedule
app.put('/api/schedules/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json() as Partial<{
        cron: string;
        agentId: string;
        message: string;
        label: string;
        channel: string;
        sender: string;
        enabled: boolean;
    }>;

    try {
        const schedule = updateSchedule(id, body);
        if (!schedule) {
            return c.json({ error: `schedule '${id}' not found` }, 404);
        }
        return c.json({ ok: true, schedule });
    } catch (err) {
        return c.json({ error: (err as Error).message }, 400);
    }
});

// DELETE /api/schedules/:id — delete a schedule by id or label
app.delete('/api/schedules/:id', (c) => {
    const id = c.req.param('id');
    const deleted = removeSchedule(id);
    if (!deleted) {
        return c.json({ error: `schedule '${id}' not found` }, 404);
    }
    return c.json({ ok: true });
});

export default app;
