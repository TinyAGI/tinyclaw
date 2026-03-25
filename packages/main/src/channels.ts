/**
 * Channel Spawner — Starts enabled messaging channels as child processes.
 * Replaces the channel-spawning logic from lib/daemon.sh and docker-entrypoint.sh.
 */

import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { getSettings, SCRIPT_DIR, log } from '@tinyagi/core';

const CHANNEL_SCRIPTS: Record<string, string> = {
    discord: 'discord.js',
    telegram: 'telegram.js',
    whatsapp: 'whatsapp.js',
};

const TOKEN_ENV_KEYS: Record<string, string> = {
    discord: 'DISCORD_BOT_TOKEN',
    telegram: 'TELEGRAM_BOT_TOKEN',
};

const children = new Map<string, ChildProcess>();

function getChannelToken(channelId: string): string | undefined {
    // Check environment first (Docker / manual override)
    const envKey = TOKEN_ENV_KEYS[channelId];
    if (envKey && process.env[envKey]) return process.env[envKey];

    // Fall back to settings.json
    const settings = getSettings();
    const channelConf = (settings.channels as any)?.[channelId];
    return channelConf?.bot_token || undefined;
}

export function startChannels(): void {
    const settings = getSettings();
    const enabled = settings.channels?.enabled ?? [];

    if (enabled.length === 0) {
        log('INFO', 'No channels enabled');
        return;
    }

    for (const channelId of enabled) {
        const script = CHANNEL_SCRIPTS[channelId];
        if (!script) {
            log('WARN', `Unknown channel: ${channelId}`);
            continue;
        }

        const envKey = TOKEN_ENV_KEYS[channelId];
        const token = getChannelToken(channelId);

        // WhatsApp doesn't need a token (uses QR code auth)
        if (envKey && !token) {
            log('WARN', `${channelId} enabled but ${envKey} not set, skipping`);
            continue;
        }

        const scriptPath = path.join(SCRIPT_DIR, 'packages', 'channels', 'dist', script);
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        if (envKey && token) {
            env[envKey] = token;
        }

        log('INFO', `Starting ${channelId} channel...`);
        const child = fork(scriptPath, [], { env, stdio: 'inherit' });

        child.on('exit', (code) => {
            log('INFO', `Channel ${channelId} exited (code ${code})`);
            children.delete(channelId);
        });

        children.set(channelId, child);
    }

    log('INFO', `Started ${children.size} channel(s): ${[...children.keys()].join(', ')}`);
}

export function stopChannels(): void {
    for (const [channelId, child] of children) {
        log('INFO', `Stopping ${channelId} channel...`);
        child.kill('SIGTERM');
    }
    children.clear();
}
