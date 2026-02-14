import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, Settings } from './types';
import { TINYCLAW_HOME } from './config';
import { log } from './logging';

const MEMORY_ROOT = path.join(TINYCLAW_HOME, 'memory');
const MEMORY_TURNS_DIR = path.join(MEMORY_ROOT, 'turns');

const DEFAULT_TOP_K = 4;
const DEFAULT_MIN_SCORE = 0.0;
const DEFAULT_MAX_CHARS = 2500;
const DEFAULT_UPDATE_INTERVAL_SECONDS = 120;

let qmdChecked = false;
let qmdAvailable = false;
let qmdUnavailableLogged = false;
let qmdCommandPath: string | null = null;
let qmdCheckKey = '';
const collectionPrepared = new Set<string>();
const lastCollectionUpdateMs = new Map<string, number>();
const MEMORY_CHANNELS = new Set(['telegram', 'discord', 'whatsapp']);

interface QmdResult {
    score: number;
    snippet: string;
    source: string;
}

interface QmdConfig {
    enabled: boolean;
    command?: string;
    topK: number;
    minScore: number;
    maxChars: number;
    updateIntervalSeconds: number;
    useSemanticSearch: boolean;
}

interface CommandResult {
    stdout: string;
    stderr: string;
}

function getQmdConfig(settings: Settings): QmdConfig {
    const memoryCfg = settings.memory?.qmd;
    const command = typeof memoryCfg?.command === 'string' ? memoryCfg.command.trim() : '';
    return {
        enabled: settings.memory?.enabled === true && memoryCfg?.enabled !== false,
        command: command || undefined,
        topK: Number.isFinite(memoryCfg?.top_k) ? Math.max(1, Number(memoryCfg?.top_k)) : DEFAULT_TOP_K,
        minScore: Number.isFinite(memoryCfg?.min_score) ? Number(memoryCfg?.min_score) : DEFAULT_MIN_SCORE,
        maxChars: Number.isFinite(memoryCfg?.max_chars) ? Math.max(500, Number(memoryCfg?.max_chars)) : DEFAULT_MAX_CHARS,
        updateIntervalSeconds: Number.isFinite(memoryCfg?.update_interval_seconds)
            ? Math.max(10, Number(memoryCfg?.update_interval_seconds))
            : DEFAULT_UPDATE_INTERVAL_SECONDS,
        useSemanticSearch: memoryCfg?.use_semantic_search === true,
    };
}

function sanitizeId(raw: string): string {
    return raw.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
}

function getAgentTurnsDir(agentId: string): string {
    return path.join(MEMORY_TURNS_DIR, sanitizeId(agentId));
}

function getCollectionName(agentId: string): string {
    return `tinyclaw-${sanitizeId(agentId)}`;
}

function ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function runCommand(command: string, args: string[], cwd?: string, timeoutMs = 12000): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
        }, timeoutMs);

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { stdout += chunk; });
        child.stderr.on('data', (chunk: string) => { stderr += chunk; });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            if (timedOut) {
                reject(new Error(`Command timed out after ${timeoutMs}ms`));
                return;
            }
            if (code === 0) {
                resolve({ stdout, stderr });
                return;
            }
            reject(new Error(stderr.trim() || `Command exited with code ${code}`));
        });
    });
}

async function isQmdAvailable(preferredCommand?: string): Promise<boolean> {
    const key = preferredCommand || '__auto__';
    if (qmdChecked && qmdCheckKey === key) {
        return qmdAvailable;
    }
    qmdChecked = true;
    qmdCheckKey = key;
    qmdAvailable = false;
    qmdCommandPath = null;

    const bundledQmd = path.join(require('os').homedir(), '.bun/bin/qmd');
    const candidates = preferredCommand ? [preferredCommand] : [bundledQmd, 'qmd'];

    try {
        for (const candidate of candidates) {
            try {
                await runCommand(candidate, ['--help'], undefined, 5000);
                qmdCommandPath = candidate;
                qmdAvailable = true;
                break;
            } catch {
                // Try next candidate.
            }
        }
    } finally {
        if (!qmdAvailable) {
            qmdCommandPath = null;
        }
    }
    return qmdAvailable;
}

function shouldUseMemoryForChannel(channel: string): boolean {
    return MEMORY_CHANNELS.has(channel);
}

async function ensureCollection(agentId: string): Promise<string> {
    ensureDir(MEMORY_ROOT);
    const agentTurnsDir = getAgentTurnsDir(agentId);
    ensureDir(agentTurnsDir);

    const collectionName = getCollectionName(agentId);
    if (!collectionPrepared.has(collectionName)) {
        try {
            await runCommand(qmdCommandPath || 'qmd', ['collection', 'add', agentTurnsDir, '--name', collectionName, '--mask', '**/*.md'], undefined, 10000);
            collectionPrepared.add(collectionName);
        } catch (error) {
            const msg = (error as Error).message.toLowerCase();
            if (msg.includes('already') || msg.includes('exists')) {
                collectionPrepared.add(collectionName);
            } else {
                throw error;
            }
        }
    }

    return collectionName;
}

async function maybeUpdateCollection(collectionName: string, updateIntervalSeconds: number): Promise<void> {
    const now = Date.now();
    const last = lastCollectionUpdateMs.get(collectionName) || 0;
    if (now - last < updateIntervalSeconds * 1000) {
        return;
    }
    await runCommand(qmdCommandPath || 'qmd', ['update', '--collections', collectionName], undefined, 15000);
    lastCollectionUpdateMs.set(collectionName, now);
}

function parseQmdResults(raw: string): QmdResult[] {
    const trimmed = raw.trim();
    if (!trimmed) {
        return [];
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch {
        return [];
    }

    const rows = Array.isArray(parsed)
        ? parsed
        : (parsed as { results?: unknown[] }).results || [];

    const results: QmdResult[] = [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') {
            continue;
        }
        const r = row as Record<string, unknown>;
        const score = typeof r.score === 'number' ? r.score : 0;
        const snippet = String(r.snippet || r.context || r.text || r.content || '').trim();
        const source = String(r.path || r.file || r.source || r.title || '').trim();
        if (!snippet) {
            continue;
        }
        results.push({ score, snippet, source });
    }
    return results;
}

function formatMemoryPrompt(results: QmdResult[], maxChars: number): string {
    if (results.length === 0) {
        return '';
    }

    const blocks: string[] = [];
    let usedChars = 0;

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const block = [
            `Snippet ${i + 1} (score=${result.score.toFixed(3)}):`,
            result.source ? `Source: ${result.source}` : 'Source: unknown',
            result.snippet,
        ].join('\n');

        if (usedChars + block.length > maxChars) {
            break;
        }
        blocks.push(block);
        usedChars += block.length;
    }

    if (blocks.length === 0) {
        return '';
    }

    return [
        '',
        '---',
        'Retrieved memory snippets (from past conversations):',
        'Use only if relevant. Prioritize current user instructions over old memory.',
        '',
        blocks.join('\n\n'),
    ].join('\n');
}

export async function enrichMessageWithMemory(
    agentId: string,
    message: string,
    settings: Settings,
    sourceChannel: string
): Promise<string> {
    const qmdCfg = getQmdConfig(settings);
    if (!qmdCfg.enabled) {
        return message;
    }
    if (!shouldUseMemoryForChannel(sourceChannel)) {
        return message;
    }

    const hasQmd = await isQmdAvailable(qmdCfg.command);
    if (!hasQmd) {
        if (!qmdUnavailableLogged) {
            log('WARN', 'qmd not found in PATH, memory retrieval disabled');
            qmdUnavailableLogged = true;
        }
        return message;
    }

    try {
        const collectionName = await ensureCollection(agentId);
        await maybeUpdateCollection(collectionName, qmdCfg.updateIntervalSeconds);

        const queryArgs = qmdCfg.useSemanticSearch
            ? ['vsearch', message, '--json', '-c', collectionName, '-n', String(qmdCfg.topK), '--min-score', String(qmdCfg.minScore)]
            : ['search', message, '--json', '-c', collectionName, '-n', String(qmdCfg.topK), '--min-score', String(qmdCfg.minScore)];

        const { stdout } = await runCommand(qmdCommandPath || 'qmd', queryArgs, undefined, 12000);
        const results = parseQmdResults(stdout);
        if (results.length === 0) {
            return message;
        }

        const memoryBlock = formatMemoryPrompt(results, qmdCfg.maxChars);
        if (!memoryBlock) {
            return message;
        }

        log('INFO', `Memory retrieval hit for @${agentId}: ${results.length} snippet(s)`);
        return `${message}${memoryBlock}`;
    } catch (error) {
        log('WARN', `Memory retrieval skipped for @${agentId}: ${(error as Error).message}`);
        return message;
    }
}

function timestampFilename(ts: number): string {
    return new Date(ts).toISOString().replace(/[:.]/g, '-');
}

function truncate(text: string, max = 16000): string {
    if (text.length <= max) {
        return text;
    }
    return `${text.substring(0, max)}\n\n[truncated]`;
}

export async function saveTurnToMemory(params: {
    agentId: string;
    agent: AgentConfig;
    channel: string;
    sender: string;
    messageId: string;
    userMessage: string;
    agentResponse: string;
    timestampMs?: number;
}): Promise<void> {
    try {
        const timestampMs = params.timestampMs || Date.now();
        const dir = getAgentTurnsDir(params.agentId);
        ensureDir(dir);

        const fileName = `${timestampFilename(timestampMs)}-${params.messageId}.md`;
        const filePath = path.join(dir, fileName);
        const lines = [
            `# Turn for @${params.agentId} (${params.agent.name})`,
            '',
            `- Timestamp: ${new Date(timestampMs).toISOString()}`,
            `- Channel: ${params.channel}`,
            `- Sender: ${params.sender}`,
            `- Message ID: ${params.messageId}`,
            '',
            '## User',
            '',
            truncate(params.userMessage),
            '',
            '## Assistant',
            '',
            truncate(params.agentResponse),
            '',
        ];

        fs.writeFileSync(filePath, lines.join('\n'));
    } catch (error) {
        log('WARN', `Failed to persist memory turn for @${params.agentId}: ${(error as Error).message}`);
    }
}
