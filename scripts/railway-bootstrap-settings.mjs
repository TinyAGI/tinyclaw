#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const tinyclawDir = path.join(projectRoot, '.tinyclaw');
const settingsFile = path.join(tinyclawDir, 'settings.json');

function toInt(value, fallback) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

function parseCsv(value, fallback = []) {
    if (!value || typeof value !== 'string') {
        return fallback;
    }
    return value
        .split(',')
        .map(v => v.trim().toLowerCase())
        .filter(Boolean);
}

function sanitizeId(value, fallback) {
    const clean = String(value || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
    return clean || fallback;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadSettingsFromEnv() {
    const rawJson = process.env.TINYCLAW_SETTINGS_JSON;
    if (rawJson) {
        return JSON.parse(rawJson);
    }

    const b64 = process.env.TINYCLAW_SETTINGS_B64;
    if (b64) {
        return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    }

    const workspacePath = process.env.TINYCLAW_WORKSPACE_PATH || path.join(projectRoot, 'tinyclaw-workspace');
    const workspaceName = process.env.TINYCLAW_WORKSPACE_NAME || path.basename(workspacePath);
    const channels = parseCsv(process.env.TINYCLAW_CHANNELS, ['telegram']);
    const provider = (process.env.TINYCLAW_PROVIDER || 'openai').toLowerCase();
    const model = process.env.TINYCLAW_MODEL || (provider === 'openai' ? 'gpt-5.3-codex' : 'sonnet');

    const defaultAgentId = sanitizeId(process.env.TINYCLAW_DEFAULT_AGENT_ID, 'assistant');
    const defaultAgentName = process.env.TINYCLAW_DEFAULT_AGENT_NAME || 'Assistant';
    const heartbeatInterval = toInt(process.env.TINYCLAW_HEARTBEAT_INTERVAL, 3600);

    const openaiApiKey = process.env.TINYCLAW_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
    const openaiBaseUrl = process.env.TINYCLAW_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL || '';

    let agents;
    if (process.env.TINYCLAW_AGENTS_JSON) {
        agents = JSON.parse(process.env.TINYCLAW_AGENTS_JSON);
    } else {
        const defaultAgent = {
            name: defaultAgentName,
            provider,
            model,
            working_directory: path.join(workspacePath, defaultAgentId),
        };
        if (provider === 'openai' && (openaiApiKey || openaiBaseUrl)) {
            defaultAgent.openai = {
                ...(openaiBaseUrl ? { base_url: openaiBaseUrl } : {}),
                ...(openaiApiKey ? { api_key: openaiApiKey } : {}),
            };
        }
        agents = { [defaultAgentId]: defaultAgent };
    }

    const settings = {
        workspace: {
            path: workspacePath,
            name: workspaceName,
        },
        channels: {
            enabled: channels,
            discord: { bot_token: process.env.DISCORD_BOT_TOKEN || '' },
            telegram: { bot_token: process.env.TELEGRAM_BOT_TOKEN || '' },
            whatsapp: {},
        },
        agents,
        models: provider === 'openai'
            ? {
                provider: 'openai',
                openai: {
                    model,
                    ...(openaiBaseUrl ? { base_url: openaiBaseUrl } : {}),
                    ...(openaiApiKey ? { api_key: openaiApiKey } : {}),
                },
            }
            : {
                provider: 'anthropic',
                anthropic: { model },
            },
        monitoring: {
            heartbeat_interval: heartbeatInterval,
        },
    };

    if (process.env.TINYCLAW_TEAMS_JSON) {
        settings.teams = JSON.parse(process.env.TINYCLAW_TEAMS_JSON);
    }

    return settings;
}

function validateSettings(settings) {
    const channels = settings?.channels?.enabled || [];
    if (!Array.isArray(channels) || channels.length === 0) {
        throw new Error('settings.channels.enabled must include at least one channel');
    }

    if (channels.includes('telegram')) {
        const token = settings?.channels?.telegram?.bot_token || process.env.TELEGRAM_BOT_TOKEN;
        if (!token) {
            throw new Error('Telegram is enabled but TELEGRAM_BOT_TOKEN is missing');
        }
    }

    if (channels.includes('discord')) {
        const token = settings?.channels?.discord?.bot_token || process.env.DISCORD_BOT_TOKEN;
        if (!token) {
            throw new Error('Discord is enabled but DISCORD_BOT_TOKEN is missing');
        }
    }
}

function ensureRuntimeDirectories(settings) {
    const workspacePath = settings?.workspace?.path || path.join(projectRoot, 'tinyclaw-workspace');
    const queueBase = path.join(tinyclawDir, 'queue');
    [
        path.join(queueBase, 'incoming'),
        path.join(queueBase, 'processing'),
        path.join(queueBase, 'outgoing'),
        path.join(tinyclawDir, 'logs'),
        path.join(tinyclawDir, 'channels'),
        path.join(tinyclawDir, 'files'),
        path.join(tinyclawDir, 'events'),
        path.join(tinyclawDir, 'chats'),
        workspacePath,
    ].forEach(ensureDir);

    const agents = settings?.agents || {};
    for (const agent of Object.values(agents)) {
        if (agent && agent.working_directory) {
            ensureDir(agent.working_directory);
        }
    }
}

try {
    ensureDir(tinyclawDir);
    const settings = loadSettingsFromEnv();
    validateSettings(settings);
    ensureRuntimeDirectories(settings);
    writeJson(settingsFile, settings);
    console.log(`[railway] wrote settings: ${settingsFile}`);
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[railway] failed to bootstrap settings: ${message}`);
    process.exit(1);
}
