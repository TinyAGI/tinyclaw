#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 * Processes one message at a time to avoid race conditions
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import 'dotenv/config';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const QUEUE_PROCESSING = path.join(SCRIPT_DIR, '.tinyclaw/queue/processing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/queue.log');
const RESET_FLAG = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
const SETTINGS_FILE = path.join(SCRIPT_DIR, '.tinyclaw/settings.json');

// Model name mapping
const CLAUDE_MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'opus': 'claude-opus-4-6',
};

const OPENAI_MODEL_IDS: Record<string, string> = {
    'gpt-4': 'gpt-4',
    'gpt-4-turbo': 'gpt-4-turbo-preview',
    'gpt-3.5-turbo': 'gpt-3.5-turbo',
};

interface Settings {
    channels?: {
        enabled?: string[];
        discord?: { bot_token?: string };
        telegram?: { bot_token?: string };
        whatsapp?: {};
    };
    models?: {
        provider?: string; // 'anthropic' or 'openai'
        anthropic?: {
            model?: string;
        };
        openai?: {
            model?: string;
            api_key?: string;
        };
    };
    monitoring?: {
        heartbeat_interval?: number;
    };
}

function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        return JSON.parse(settingsData);
    } catch {
        return {};
    }
}

function getModelFlag(): string {
    try {
        const settings = getSettings();
        const model = settings?.models?.anthropic?.model;
        if (model) {
            const modelId = CLAUDE_MODEL_IDS[model];
            if (modelId) {
                return `--model ${modelId} `;
            }
        }
    } catch { }
    return '';
}

// Call OpenAI API
async function callOpenAI(message: string): Promise<string> {
    const settings = getSettings();
    const openaiApiKey = settings?.models?.openai?.api_key || process.env.OPENAI_API_KEY;

    if (!openaiApiKey) {
        throw new Error('OpenAI API key not configured');
    }

    const openai = new OpenAI({ apiKey: openaiApiKey });
    const model = settings?.models?.openai?.model || 'gpt-4';
    const modelId = OPENAI_MODEL_IDS[model] || model;

    const completion = await openai.chat.completions.create({
        model: modelId,
        messages: [
            {
                role: 'system',
                content: 'You are a helpful AI assistant. Provide clear, concise, and accurate responses.'
            },
            {
                role: 'user',
                content: message
            }
        ],
        temperature: 0.7,
        max_tokens: 4000,
    });

    return completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
}

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, QUEUE_PROCESSING, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

interface MessageData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    timestamp: number;
    messageId: string;
}

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
}

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Process a single message
async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));

    try {
        // Move to processing to mark as in-progress
        fs.renameSync(messageFile, processingFile);

        // Read message
        const messageData: MessageData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        const { channel, sender, message, timestamp, messageId } = messageData;

        log('INFO', `Processing [${channel}] from ${sender}: ${message.substring(0, 50)}...`);

        // Get provider setting
        const settings = getSettings();
        const provider = settings?.models?.provider || 'anthropic';

        // Call AI provider
        let response: string;
        try {
            if (provider === 'openai') {
                log('INFO', `Using OpenAI provider`);
                response = await callOpenAI(message);
            } else {
                // Default to Claude (Anthropic)
                log('INFO', `Using Claude provider`);

                // Check if we should reset conversation (start fresh without -c)
                const shouldReset = fs.existsSync(RESET_FLAG);
                const continueFlag = shouldReset ? '' : '-c ';

                if (shouldReset) {
                    log('INFO', '🔄 Resetting conversation (starting fresh without -c)');
                    fs.unlinkSync(RESET_FLAG);
                }

                const modelFlag = getModelFlag();
                response = execSync(
                    `cd "${SCRIPT_DIR}" && claude --dangerously-skip-permissions ${modelFlag}${continueFlag}-p "${message.replace(/"/g, '\\"')}"`,
                    {
                        encoding: "utf-8",
                        timeout: 0, // No timeout - wait for Claude to finish (agents can run long)
                        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                    },
                );
            }
        } catch (error) {
            log('ERROR', `${provider === 'openai' ? 'OpenAI' : 'Claude'} error: ${(error as Error).message}`);
            response = "Sorry, I encountered an error processing your request.";
        }

        // Clean response
        response = response.trim();

        // Limit response length
        if (response.length > 4000) {
            response = response.substring(0, 3900) + '\n\n[Response truncated...]';
        }

        // Write response to outgoing queue
        const responseData: ResponseData = {
            channel,
            sender,
            message: response,
            originalMessage: message,
            timestamp: Date.now(),
            messageId
        };

        // For heartbeat messages, write to a separate location (they handle their own responses)
        const responseFile = channel === 'heartbeat'
            ? path.join(QUEUE_OUTGOING, `${messageId}.json`)
            : path.join(QUEUE_OUTGOING, `${channel}_${messageId}_${Date.now()}.json`);

        fs.writeFileSync(responseFile, JSON.stringify(responseData, null, 2));

        log('INFO', `✓ Response ready [${channel}] ${sender} (${response.length} chars)`);

        // Clean up processing file
        fs.unlinkSync(processingFile);

    } catch (error) {
        log('ERROR', `Processing error: ${(error as Error).message}`);

        // Move back to incoming for retry
        if (fs.existsSync(processingFile)) {
            try {
                fs.renameSync(processingFile, messageFile);
            } catch (e) {
                log('ERROR', `Failed to move file back: ${(e as Error).message}`);
            }
        }
    }
}

interface QueueFile {
    name: string;
    path: string;
    time: number;
}

// Main processing loop
async function processQueue(): Promise<void> {
    try {
        // Get all files from incoming queue, sorted by timestamp
        const files: QueueFile[] = fs.readdirSync(QUEUE_INCOMING)
            .filter(f => f.endsWith('.json'))
            .map(f => ({
                name: f,
                path: path.join(QUEUE_INCOMING, f),
                time: fs.statSync(path.join(QUEUE_INCOMING, f)).mtimeMs
            }))
            .sort((a, b) => a.time - b.time);

        if (files.length > 0) {
            log('DEBUG', `Found ${files.length} message(s) in queue`);

            // Process one at a time
            for (const file of files) {
                await processMessage(file.path);
            }
        }
    } catch (error) {
        log('ERROR', `Queue processing error: ${(error as Error).message}`);
    }
}

// Main loop
log('INFO', 'Queue processor started');
log('INFO', `Watching: ${QUEUE_INCOMING}`);

// Process queue every 1 second
setInterval(processQueue, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down queue processor...');
    process.exit(0);
});
