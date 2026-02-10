#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 * Processes one message at a time to avoid race conditions
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
    CLAUDE_MODEL_IDS,
    CODEX_MODEL_IDS,
    DEFAULT_CLAUDE_MODEL,
    DEFAULT_CLI_PROVIDER,
    DEFAULT_CODEX_MODEL,
    type ClaudeModelAlias,
    type CliProvider,
    type CodexModelAlias,
} from './provider-config';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const QUEUE_PROCESSING = path.join(SCRIPT_DIR, '.tinyclaw/queue/processing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/queue.log');
const RESET_FLAG = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
const SETTINGS_FILE = path.join(SCRIPT_DIR, '.tinyclaw/settings.json');
const CODEX_THREAD_FILE = path.join(SCRIPT_DIR, '.tinyclaw/codex_thread_id');

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

interface QueueSettings {
    cliProvider: CliProvider;
    claudeModel: ClaudeModelAlias;
    codexModel: CodexModelAlias;
}

interface CodexRunResult {
    threadId: string;
    response: string;
}

interface CommandResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
}

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

function readSettings(): QueueSettings {
    const defaults: QueueSettings = {
        cliProvider: DEFAULT_CLI_PROVIDER,
        claudeModel: DEFAULT_CLAUDE_MODEL,
        codexModel: DEFAULT_CODEX_MODEL,
    };

    try {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const data = JSON.parse(raw) as {
            cli_provider?: string;
            claude_model?: string;
            codex_model?: string;
            model?: string;
        };

        const legacyModel = data.model;
        const cliProvider = data.cli_provider === 'codex' ? 'codex' : 'claude';
        const claudeModel = (data.claude_model ?? legacyModel) === 'opus' ? 'opus' : 'sonnet';

        let codexModel: CodexModelAlias = DEFAULT_CODEX_MODEL;
        if (data.codex_model === 'gpt5') {
            codexModel = 'gpt5';
        } else if (data.codex_model === 'gpt5mini') {
            codexModel = 'gpt5mini';
        }

        return {
            cliProvider,
            claudeModel,
            codexModel,
        };
    } catch {
        return defaults;
    }
}

function runCommand(command: string, args: string[]): CommandResult {
    const result = spawnSync(command, args, {
        cwd: SCRIPT_DIR,
        encoding: 'utf-8',
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
    });

    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    const exitCode = result.status;

    return {
        ok: !result.error && exitCode === 0,
        stdout,
        stderr,
        exitCode,
    };
}

function readThreadId(): string | null {
    if (!fs.existsSync(CODEX_THREAD_FILE)) {
        return null;
    }

    const threadId = fs.readFileSync(CODEX_THREAD_FILE, 'utf8').trim();
    return threadId.length > 0 ? threadId : null;
}

function writeThreadId(threadId: string): void {
    fs.writeFileSync(CODEX_THREAD_FILE, threadId);
}

function clearThreadId(): void {
    if (fs.existsSync(CODEX_THREAD_FILE)) {
        fs.unlinkSync(CODEX_THREAD_FILE);
    }
}

function parseCodexJsonOutput(stdout: string): { threadId?: string; response?: string } {
    const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
    let threadId: string | undefined;
    let response: string | undefined;

    for (const line of lines) {
        try {
            const event = JSON.parse(line) as {
                type?: string;
                thread_id?: string;
                item?: { type?: string; text?: string };
            };

            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
                threadId = event.thread_id;
            }

            if (
                event.type === 'item.completed' &&
                event.item?.type === 'agent_message' &&
                typeof event.item.text === 'string'
            ) {
                response = event.item.text;
            }
        } catch {
            // Ignore non-JSON lines.
        }
    }

    return { threadId, response };
}

function runWithClaude(message: string, shouldReset: boolean, settings: QueueSettings): string {
    const modelId = CLAUDE_MODEL_IDS[settings.claudeModel];
    const args: string[] = ['--dangerously-skip-permissions', '--model', modelId];

    if (!shouldReset) {
        args.push('-c');
    }

    args.push('-p', message);

    const result = runCommand('claude', args);
    if (!result.ok) {
        const details = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode ?? 'unknown'}`;
        throw new Error(`Claude exec failed: ${details.substring(0, 500)}`);
    }

    return result.stdout;
}

function runWithCodex(message: string, shouldReset: boolean, settings: QueueSettings): CodexRunResult {
    if (shouldReset) {
        clearThreadId();
        log('INFO', '🔄 Cleared Codex thread id for fresh conversation');
    }

    const modelId = CODEX_MODEL_IDS[settings.codexModel];
    const savedThreadId = readThreadId();

    if (savedThreadId) {
        const resumeArgs = ['exec', 'resume', '--skip-git-repo-check', '--json', '--model', modelId, savedThreadId, message];
        const resume = runCommand('codex', resumeArgs);
        const parsed = parseCodexJsonOutput(resume.stdout);

        if (resume.ok && parsed.response) {
            const threadId = parsed.threadId ?? savedThreadId;
            writeThreadId(threadId);
            return { threadId, response: parsed.response };
        }

        const details = resume.stderr.trim() || resume.stdout.trim() || `exit code ${resume.exitCode ?? 'unknown'}`;
        log('WARN', `Codex resume failed, starting fresh thread. Details: ${details.substring(0, 300)}`);
    }

    const freshArgs = ['exec', '--skip-git-repo-check', '--json', '--model', modelId, message];
    const fresh = runCommand('codex', freshArgs);
    const parsed = parseCodexJsonOutput(fresh.stdout);

    if (!fresh.ok) {
        const details = fresh.stderr.trim() || fresh.stdout.trim() || `exit code ${fresh.exitCode ?? 'unknown'}`;
        throw new Error(`Codex exec failed: ${details.substring(0, 500)}`);
    }

    if (!parsed.response) {
        throw new Error('Codex exec completed without an assistant response');
    }

    if (!parsed.threadId) {
        throw new Error('Codex exec completed without a thread id');
    }

    writeThreadId(parsed.threadId);
    return { threadId: parsed.threadId, response: parsed.response };
}

// Process a single message
async function processMessage(messageFile: string): Promise<void> {
    const processingFile = path.join(QUEUE_PROCESSING, path.basename(messageFile));

    try {
        // Move to processing to mark as in-progress
        fs.renameSync(messageFile, processingFile);

        // Read message
        const messageData: MessageData = JSON.parse(fs.readFileSync(processingFile, 'utf8'));
        const { channel, sender, message, messageId } = messageData;

        log('INFO', `Processing [${channel}] from ${sender}: ${message.substring(0, 50)}...`);

        const shouldReset = fs.existsSync(RESET_FLAG);
        if (shouldReset) {
            log('INFO', '🔄 Resetting conversation (starting fresh for active provider)');
            fs.unlinkSync(RESET_FLAG);
        }

        const settings = readSettings();

        let response: string;
        try {
            if (settings.cliProvider === 'codex') {
                response = runWithCodex(message, shouldReset, settings).response;
            } else {
                response = runWithClaude(message, shouldReset, settings);
            }
        } catch (error) {
            log('ERROR', `${settings.cliProvider.toUpperCase()} error: ${(error as Error).message}`);
            response = 'Sorry, I encountered an error processing your request.';
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
            messageId,
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
                time: fs.statSync(path.join(QUEUE_INCOMING, f)).mtimeMs,
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
