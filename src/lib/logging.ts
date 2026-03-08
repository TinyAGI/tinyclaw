import fs from 'fs';
import path from 'path';
import { Writable } from 'stream';
import pino, { type Logger } from 'pino';
import { LOG_DIR } from './config';

export type RuntimeLogFile = 'queue' | 'telegram' | 'discord' | 'whatsapp' | 'daemon' | 'heartbeat';
export type LogSource = RuntimeLogFile | 'api';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    time: string;
    level: LogLevel;
    source: LogSource | string;
    component: string;
    msg: string;
    channel?: string;
    agentId?: string;
    messageId?: string;
    conversationId?: string;
    fromAgent?: string;
    toAgent?: string;
    teamId?: string;
    sender?: string;
    excerpt?: string;
    context?: Record<string, unknown>;
    err?: {
        type?: string;
        message?: string;
        stack?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface CreateLoggerOptions {
    runtime: RuntimeLogFile;
    source?: LogSource;
    component: string;
    bindings?: Record<string, unknown>;
}

interface ReadLogsOptions {
    limit?: number;
    source?: string[];
    level?: string;
    channel?: string;
    agentId?: string;
    messageId?: string;
    conversationId?: string;
    search?: string;
}

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_ROTATED_FILES = 5;
const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LEVEL_MAP: Record<string, LogLevel> = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    WARNING: 'warn',
    ERROR: 'error',
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    warning: 'warn',
    error: 'error',
};
const SOURCE_TO_RUNTIME: Record<string, RuntimeLogFile> = {
    queue: 'queue',
    api: 'queue',
    telegram: 'telegram',
    discord: 'discord',
    whatsapp: 'whatsapp',
    daemon: 'daemon',
    heartbeat: 'heartbeat',
};

fs.mkdirSync(LOG_DIR, { recursive: true });

class RotatingFileStream extends Writable {
    private stream: fs.WriteStream;

    private bytesWritten: number;

    constructor(private readonly filePath: string) {
        super();
        this.bytesWritten = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
        this.stream = fs.createWriteStream(filePath, { flags: 'a' });
    }

    _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        try {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
            this.rotateIfNeeded(buffer.length);
            this.stream.write(buffer, (error) => {
                if (!error) {
                    this.bytesWritten += buffer.length;
                }
                callback(error ?? undefined);
            });
        } catch (error) {
            callback(error as Error);
        }
    }

    _final(callback: (error?: Error | null) => void): void {
        this.stream.end(() => callback());
    }

    private rotateIfNeeded(incomingBytes: number): void {
        if (this.bytesWritten + incomingBytes <= MAX_LOG_BYTES) {
            return;
        }

        this.stream.end();

        for (let index = MAX_ROTATED_FILES; index >= 1; index--) {
            const current = rotatedFilePath(this.filePath, index);
            const previous = index === 1 ? this.filePath : rotatedFilePath(this.filePath, index - 1);

            if (!fs.existsSync(previous)) {
                continue;
            }

            if (fs.existsSync(current)) {
                fs.unlinkSync(current);
            }

            fs.renameSync(previous, current);
        }

        this.bytesWritten = 0;
        this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
    }
}

const destinations = new Map<RuntimeLogFile, RotatingFileStream>();
const runtimeLoggers = new Map<RuntimeLogFile, Logger>();

function rotatedFilePath(filePath: string, index: number): string {
    const ext = path.extname(filePath);
    const base = filePath.slice(0, filePath.length - ext.length);
    return `${base}.${index}${ext}`;
}

function normalizeLevel(level?: string): LogLevel {
    if (!level) {
        return 'info';
    }
    return LEVEL_MAP[level] || 'info';
}

function getConfiguredLogLevel(): LogLevel {
    return normalizeLevel(process.env.LOG_LEVEL);
}

function getDestination(runtime: RuntimeLogFile): RotatingFileStream {
    let destination = destinations.get(runtime);
    if (!destination) {
        destination = new RotatingFileStream(path.join(LOG_DIR, `${runtime}.log`));
        destinations.set(runtime, destination);
    }
    return destination;
}

function getRuntimeLogger(runtime: RuntimeLogFile): Logger {
    let logger = runtimeLoggers.get(runtime);
    if (!logger) {
        logger = pino({
            level: getConfiguredLogLevel(),
            base: undefined,
            messageKey: 'msg',
            timestamp: pino.stdTimeFunctions.isoTime,
            formatters: {
                level: (label) => ({ level: label }),
            },
            serializers: {
                err: pino.stdSerializers.err,
            },
        }, getDestination(runtime));
        runtimeLoggers.set(runtime, logger);
    }
    return logger;
}

export function createLogger(options: CreateLoggerOptions): Logger {
    const { runtime, source = options.runtime, component, bindings = {} } = options;
    return getRuntimeLogger(runtime).child({ source, component, ...bindings });
}

export function logAtLevel(
    logger: Logger,
    level: string,
    msg: string,
    bindings?: Record<string, unknown>
): void {
    const normalized = normalizeLevel(level);
    const payload = bindings ?? {};
    if (normalized === 'debug') {
        logger.debug(payload, msg);
    } else if (normalized === 'warn') {
        logger.warn(payload, msg);
    } else if (normalized === 'error') {
        logger.error(payload, msg);
    } else {
        logger.info(payload, msg);
    }
}

export function logError(
    logger: Logger,
    error: unknown,
    msg: string,
    context?: Record<string, unknown>
): void {
    const err = error instanceof Error ? error : new Error(String(error));
    if (context && Object.keys(context).length > 0) {
        logger.error({ err, context }, msg);
        return;
    }
    logger.error({ err }, msg);
}

export function isDebugEnabled(logger: Logger): boolean {
    return logger.isLevelEnabled('debug');
}

export function excerptText(value: string, maxLength = 160): string {
    const compact = value.replace(/\s+/g, ' ').trim();
    if (compact.length <= maxLength) {
        return compact;
    }
    return `${compact.slice(0, maxLength - 1)}...`;
}

function listFilesForRuntime(runtime: RuntimeLogFile): string[] {
    const filePath = path.join(LOG_DIR, `${runtime}.log`);
    const files = [filePath];
    for (let index = 1; index <= MAX_ROTATED_FILES; index++) {
        files.push(rotatedFilePath(filePath, index));
    }
    return files.filter(file => fs.existsSync(file));
}

function readEntriesFromFile(filePath: string): LogEntry[] {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        if (!raw.trim()) {
            return [];
        }
        return raw
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .flatMap((line) => {
                try {
                    return [JSON.parse(line) as LogEntry];
                } catch {
                    return [];
                }
            });
    } catch {
        return [];
    }
}

function includesSearch(entry: LogEntry, search: string): boolean {
    const haystacks = [
        entry.msg,
        entry.excerpt,
        entry.messageId,
        entry.conversationId,
        entry.agentId,
        entry.fromAgent,
        entry.toAgent,
        entry.sender,
        entry.channel,
        entry.teamId,
        entry.err?.message,
        entry.err?.stack,
        entry.context ? JSON.stringify(entry.context) : '',
    ];

    return haystacks.some((item) => typeof item === 'string' && item.toLowerCase().includes(search));
}

export function readLogEntries(options: ReadLogsOptions = {}): LogEntry[] {
    const sourceFilter = (options.source ?? []).map(item => item.trim()).filter(Boolean);
    const runtimes = sourceFilter.length > 0
        ? Array.from(new Set(sourceFilter.map(source => SOURCE_TO_RUNTIME[source]).filter(Boolean)))
        : (Object.keys(SOURCE_TO_RUNTIME) as Array<keyof typeof SOURCE_TO_RUNTIME>)
            .map(source => SOURCE_TO_RUNTIME[source])
            .filter((runtime, index, list) => list.indexOf(runtime) === index);

    const entries = runtimes
        .flatMap(runtime => listFilesForRuntime(runtime).flatMap(readEntriesFromFile))
        .filter((entry) => {
            if (sourceFilter.length > 0 && !sourceFilter.includes(String(entry.source))) {
                return false;
            }
            if (options.level && String(entry.level) !== options.level) {
                return false;
            }
            if (options.channel && String(entry.channel ?? '') !== options.channel) {
                return false;
            }
            if (options.agentId && String(entry.agentId ?? '') !== options.agentId) {
                return false;
            }
            if (options.messageId && String(entry.messageId ?? '') !== options.messageId) {
                return false;
            }
            if (options.conversationId && String(entry.conversationId ?? '') !== options.conversationId) {
                return false;
            }
            if (options.search && !includesSearch(entry, options.search.toLowerCase())) {
                return false;
            }
            return true;
        })
        .sort((a, b) => Date.parse(String(b.time)) - Date.parse(String(a.time)));

    return entries.slice(0, options.limit ?? 100);
}

