#!/usr/bin/env node
import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { SCRIPT_DIR } from '@tinyagi/core';

const API_PORT = process.env.TINYAGI_API_PORT || '3777';
const API_URL = `http://localhost:${API_PORT}`;

function sendMessage(message: string, source = 'cli') {
    const payload = JSON.stringify({ message, channel: 'cli', sender: source });

    const url = new URL(`${API_URL}/api/message`);
    const req = http.request({
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        },
    }, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
            try {
                const result = JSON.parse(body);
                if (result.ok) {
                    console.log(`Message enqueued: ${result.messageId}`);
                } else {
                    console.error(`Failed to enqueue message: ${body}`);
                }
            } catch {
                console.error(`Failed to parse response: ${body}`);
            }
        });
    });

    req.on('error', (err) => {
        console.error(`Failed to send message: ${err.message}`);
        process.exit(1);
    });

    req.write(payload);
    req.end();
}

function channelsReset(channel: string) {
    const knownChannels = ['telegram', 'discord', 'whatsapp'];

    if (!knownChannels.includes(channel)) {
        p.log.error(`Usage: channels reset {${knownChannels.join('|')}}`);
        process.exit(1);
    }

    if (channel === 'whatsapp') {
        const paths = [
            path.join(SCRIPT_DIR, '.tinyagi', 'whatsapp-session'),
            path.join(SCRIPT_DIR, '.tinyagi', 'channels', 'whatsapp_ready'),
            path.join(SCRIPT_DIR, '.tinyagi', 'channels', 'whatsapp_qr.txt'),
            path.join(SCRIPT_DIR, '.wwebjs_cache'),
        ];
        for (const p of paths) {
            fs.rmSync(p, { recursive: true, force: true });
        }
        p.log.success('WhatsApp session cleared');
        p.log.message('Restart TinyAGI to re-authenticate: tinyagi restart');
        return;
    }

    // Token-based channels
    p.log.message(`To reset ${channel}, run the setup wizard to update your bot token:`);
    p.log.message('  tinyagi setup');
    p.log.message(`Or manually edit .tinyagi/settings.json to change the ${channel} token.`);
}

// --- CLI dispatch ---

const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
    case 'send':
        if (!arg) {
            p.log.error('Usage: messaging send <message>');
            process.exit(1);
        }
        sendMessage(arg);
        break;
    case 'channels-reset':
        if (!arg) {
            p.log.error('Usage: messaging channels-reset <channel>');
            process.exit(1);
        }
        channelsReset(arg);
        break;
    default:
        p.log.error(`Unknown messaging command: ${command}`);
        process.exit(1);
}
