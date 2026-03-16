#!/usr/bin/env node
import * as p from '@clack/prompts';
import { getSchedules, addSchedule, removeSchedule } from '@tinyclaw/core';
import { unwrap, required, requireSettings, printBanner } from './shared.ts';

// --- schedule list ---

function scheduleList(agentFilter?: string) {
    const schedules = getSchedules();
    const filtered = agentFilter
        ? schedules.filter(s => s.agentId === agentFilter)
        : schedules;

    if (filtered.length === 0) {
        p.log.warn(agentFilter
            ? `No schedules found for agent @${agentFilter}.`
            : 'No schedules found.');
        p.log.message('Create one with: tinyclaw schedule create');
        return;
    }

    p.log.info(`Schedules${agentFilter ? ` for @${agentFilter}` : ''}`);
    for (const s of filtered) {
        const status = s.enabled ? 'enabled' : 'disabled';
        p.log.message(`  ${s.label} (${status})`);
        p.log.message(`    Cron:    ${s.cron}`);
        p.log.message(`    Agent:   @${s.agentId}`);
        p.log.message(`    Message: ${s.message.length > 60 ? s.message.slice(0, 60) + '...' : s.message}`);
        p.log.message(`    ID:      ${s.id}`);
        p.log.message('');
    }
    p.log.message(`${filtered.length} schedule(s) total.`);
}

// --- schedule create ---

async function scheduleCreate() {
    const settings = requireSettings();
    const agents = settings.agents || {};
    const agentIds = Object.keys(agents);

    if (agentIds.length === 0) {
        p.log.error('No agents configured. Add an agent first with: tinyclaw agent add');
        process.exit(1);
    }

    printBanner();
    p.intro('Create Schedule');

    const agentId = unwrap(await p.select({
        message: 'Target agent',
        options: agentIds.map(id => ({
            value: id,
            label: `@${id} — ${agents[id].name}`,
        })),
    })) as string;

    const cronExpr = unwrap(await p.text({
        message: 'Cron expression (5 fields, e.g. "0 9 * * *" for daily 9am)',
        placeholder: '0 9 * * *',
        validate: (v) => {
            if (!v?.trim()) return 'Required';
            if (v.trim().split(/\s+/).length !== 5) return 'Must have exactly 5 fields';
        },
    }));

    const message = unwrap(await p.text({
        message: 'Task message (what should the agent do?)',
        validate: required,
    }));

    const label = unwrap(await p.text({
        message: 'Label (optional, for easy identification)',
        placeholder: 'auto-generated',
    })) || undefined;

    try {
        const schedule = addSchedule({
            cron: cronExpr,
            agentId,
            message,
            label,
        });
        p.log.success(`Schedule created!`);
        p.log.message(`  Label: ${schedule.label}`);
        p.log.message(`  Cron:  ${schedule.cron}`);
        p.log.message(`  Agent: @${schedule.agentId}`);
        p.outro(`The agent will receive the task at the scheduled times.`);
    } catch (err) {
        p.log.error((err as Error).message);
        process.exit(1);
    }
}

// --- schedule delete ---

async function scheduleDelete(idOrLabel: string) {
    const deleted = removeSchedule(idOrLabel);
    if (!deleted) {
        p.log.error(`No schedule found with ID or label '${idOrLabel}'.`);
        const schedules = getSchedules();
        if (schedules.length > 0) {
            p.log.message('Available schedules:');
            for (const s of schedules) {
                p.log.message(`  ${s.label} (${s.id})`);
            }
        }
        process.exit(1);
    }
    p.log.success(`Schedule '${idOrLabel}' deleted.`);
}

// --- CLI dispatch ---

const command = process.argv[2];
const arg = process.argv[3];

async function run() {
    switch (command) {
        case 'list':
        case 'ls': {
            let agentFilter: string | undefined;
            if (arg === '--agent' && process.argv[4]) {
                agentFilter = process.argv[4];
            }
            scheduleList(agentFilter);
            break;
        }
        case 'create':
        case 'add':
            await scheduleCreate();
            break;
        case 'delete':
        case 'rm':
        case 'remove':
            if (!arg) {
                p.log.error('Usage: schedule delete <id-or-label>');
                process.exit(1);
            }
            await scheduleDelete(arg);
            break;
        default:
            p.log.error(`Unknown schedule command: ${command || '(none)'}`);
            p.log.message('Usage:');
            p.log.message('  tinyclaw schedule list [--agent ID]');
            p.log.message('  tinyclaw schedule create');
            p.log.message('  tinyclaw schedule delete <id-or-label>');
            process.exit(1);
    }
}

run().catch(err => {
    p.log.error(err.message);
    process.exit(1);
});
