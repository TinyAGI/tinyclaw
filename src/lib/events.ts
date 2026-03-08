/**
 * Pluggable event listeners. The API server registers an SSE listener and the
 * plugin system registers event handlers here. This remains separate from the
 * file-based logger so live events and historical logs can evolve independently.
 */
type EventListener = (type: string, data: Record<string, unknown>) => void;

const eventListeners: EventListener[] = [];

export function onEvent(listener: EventListener): () => void {
    eventListeners.push(listener);
    let removed = false;
    return () => {
        if (removed) {
            return;
        }
        removed = true;
        const index = eventListeners.indexOf(listener);
        if (index >= 0) {
            eventListeners.splice(index, 1);
        }
    };
}

export function emitEvent(type: string, data: Record<string, unknown>): void {
    for (const listener of eventListeners) {
        try {
            listener(type, data);
        } catch {
            // Event subscribers should never break the runtime path.
        }
    }
}
