#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 * Processes one message at a time to avoid race conditions
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

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
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-opus-4-6': 'claude-opus-4-6'
};

const CODEX_MODEL_IDS: Record<string, string> = {
    'gpt-5.2': 'gpt-5.2',
    'gpt-5.3-codex': 'gpt-5.3-codex',
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
        };
    };
    monitoring?: {
        heartbeat_interval?: number;
    };
}

function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings: Settings = JSON.parse(settingsData);

        // Auto-detect provider if not specified
        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.anthropic) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'anthropic';
            }
        }

        return settings;
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
                return modelId;
            }
        }
    } catch { }
    return '';
}

function getCodexModelFlag(): string {
    try {
        const settings = getSettings();
        const model = settings?.models?.openai?.model;
        if (model) {
            const modelId = CODEX_MODEL_IDS[model] || model;
            return modelId;
        }
    } catch { }
    return '';
}

async function runCommand(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
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
    files?: string[];
}

interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    files?: string[];
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
                // Use Codex CLI
                log('INFO', `Using Codex CLI`);

                // Check if we should reset conversation (start fresh without resume)
                const shouldReset = fs.existsSync(RESET_FLAG);
                const shouldResume = !shouldReset;

                if (shouldReset) {
                    log('INFO', '🔄 Resetting Codex conversation (starting fresh without resume)');
                    fs.unlinkSync(RESET_FLAG);
                }

                const modelId = getCodexModelFlag();
                const codexArgs = ['exec'];
                if (shouldResume) {
                    codexArgs.push('resume', '--last');
                }
                if (modelId) {
                    codexArgs.push('--model', modelId);
                }
                codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

                const codexOutput = await runCommand('codex', codexArgs);

                // Parse JSONL output and extract final agent_message
                response = '';
                const lines = codexOutput.trim().split('\n');
                for (const line of lines) {
                    try {
                        const json = JSON.parse(line);
                        if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                            response = json.item.text;
                        }
                    } catch (e) {
                        // Ignore lines that aren't valid JSON
                    }
                }

                if (!response) {
                    response = 'Sorry, I could not generate a response from Codex.';
                }
            } else {
                // Default to Claude (Anthropic)
                log('INFO', `Using Claude provider`);

                // Check if we should reset conversation (start fresh without -c)
                const shouldReset = fs.existsSync(RESET_FLAG);
                const continueConversation = !shouldReset;

                if (shouldReset) {
                    log('INFO', '🔄 Resetting conversation (starting fresh without -c)');
                    fs.unlinkSync(RESET_FLAG);
                }

                const modelId = getModelFlag();
                const claudeArgs = ['--dangerously-skip-permissions'];
                if (modelId) {
                    claudeArgs.push('--model', modelId);
                }
                if (continueConversation) {
                    claudeArgs.push('-c');
                }
                claudeArgs.push('-p', message);

                response = await runCommand('claude', claudeArgs);
            }
        } catch (error) {
            log('ERROR', `${provider === 'openai' ? 'Codex' : 'Claude'} error: ${(error as Error).message}`);
            response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
        }

        // Detect file references in the response: [send_file: /path/to/file]
        response = response.trim();
        const outboundFilesSet = new Set<string>();
        const fileRefRegex = /\[send_file:\s*([^\]]+)\]/g;
        let fileMatch;
        while ((fileMatch = fileRefRegex.exec(response)) !== null) {
            const filePath = fileMatch[1].trim();
            if (fs.existsSync(filePath)) {
                outboundFilesSet.add(filePath);
            }
        }
        const outboundFiles = Array.from(outboundFilesSet);

        // Remove the [send_file: ...] tags from the response text
        if (outboundFiles.length > 0) {
            response = response.replace(fileRefRegex, '').trim();
        }

        // Limit response length after tags are parsed and removed
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
            messageId,
            files: outboundFiles.length > 0 ? outboundFiles : undefined,
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
