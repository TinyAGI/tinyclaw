import fs from 'fs';
import { LOG_FILE } from './config';

export function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

type EventListener = (type: string, data: Record<string, unknown>) => void;
const eventListeners: EventListener[] = [];

export function onEvent(listener: EventListener): void {
    eventListeners.push(listener);
}

export function emitEvent(type: string, data: Record<string, unknown>): void {
    for (const listener of eventListeners) {
        try { listener(type, data); } catch { /* never break the queue processor */ }
    }
}
