/**
 * Plugin System for TinyClaw
 *
 * Plugins auto-discover from .tinyclaw/plugins/ folder.
 * Each plugin exports an activate() function and/or a hooks object from index.ts.
 */

import fs from 'fs';
import path from 'path';
import { TINYCLAW_HOME } from './config';
import { onEvent } from './events';
import { createLogger, logAtLevel, logError } from './logging';

// Types
export interface PluginEvent {
    type: string;
    timestamp: number;
    [key: string]: unknown;
}

export interface HookContext {
    channel: string;
    sender: string;
    messageId: string;
    originalMessage: string;
}

export interface HookMetadata {
    parseMode?: string;
    [key: string]: unknown;
}

export interface HookResult {
    text: string;
    metadata: HookMetadata;
}

export interface Hooks {
    transformOutgoing?(message: string, ctx: HookContext): string | HookResult | Promise<string | HookResult>;
    transformIncoming?(message: string, ctx: HookContext): string | HookResult | Promise<string | HookResult>;
}

export interface PluginContext {
    on(eventType: string | '*', handler: (event: PluginEvent) => void): void;
    log(level: string, message: string): void;
    getTinyClawHome(): string;
}

interface LoadedPlugin {
    name: string;
    hooks?: Hooks;
}

// Internal state
const loadedPlugins: LoadedPlugin[] = [];
const eventHandlers = new Map<string, Array<(event: PluginEvent) => void>>();
const logger = createLogger({ runtime: 'queue', source: 'queue', component: 'plugins' });

/**
 * Create the plugin context passed to activate() functions.
 */
function createPluginContext(pluginName: string): PluginContext {
    return {
        on(eventType: string, handler: (event: PluginEvent) => void): void {
            const handlers = eventHandlers.get(eventType) || [];
            handlers.push(handler);
            eventHandlers.set(eventType, handlers);
        },
        log(level: string, message: string): void {
            logAtLevel(
                logger.child({ context: { pluginName }, component: 'plugin' }),
                level,
                message
            );
        },
        getTinyClawHome(): string {
            return TINYCLAW_HOME;
        },
    };
}

/**
 * Load all plugins from .tinyclaw/plugins/.
 * Each plugin directory should have an index.ts/index.js that exports:
 *   - activate(ctx: PluginContext): void  (optional)
 *   - hooks: Hooks                        (optional)
 */
export async function loadPlugins(): Promise<void> {
    const pluginsDir = path.join(TINYCLAW_HOME, 'plugins');

    if (!fs.existsSync(pluginsDir)) {
        logger.debug('No plugins directory found');
        return;
    }

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const pluginName = entry.name;
        const pluginDir = path.join(pluginsDir, pluginName);

        // Try to load index.js or index.ts (compiled)
        const indexJs = path.join(pluginDir, 'index.js');
        const indexTs = path.join(pluginDir, 'index.ts');

        let indexPath: string | null = null;
        if (fs.existsSync(indexJs)) {
            indexPath = indexJs;
        } else if (fs.existsSync(indexTs)) {
            indexPath = indexTs;
        }

        if (!indexPath) {
            logger.warn({ context: { pluginName } }, 'Plugin has no index.js or index.ts, skipping');
            continue;
        }

        try {
            // Dynamic import
            const pluginModule = await import(indexPath);
            const plugin: LoadedPlugin = { name: pluginName };

            // Call activate() if present
            if (typeof pluginModule.activate === 'function') {
                const ctx = createPluginContext(pluginName);
                await pluginModule.activate(ctx);
            }

            // Store hooks if present
            if (pluginModule.hooks) {
                plugin.hooks = pluginModule.hooks;
            }

            loadedPlugins.push(plugin);
            logger.info({ context: { pluginName } }, 'Loaded plugin');
        } catch (error) {
            logError(logger, error, 'Failed to load plugin', { pluginName });
        }
    }

    if (loadedPlugins.length > 0) {
        logger.info({ context: { loadedPlugins: loadedPlugins.length } }, 'Plugins loaded');

        // Register as an event listener so all emitEvent() calls get broadcast to plugins
        onEvent((type, data) => {
            broadcastEvent({ type, timestamp: Date.now(), ...data });
        });
    }
}

/**
 * Run all transformOutgoing hooks on a message.
 */
export async function runOutgoingHooks(message: string, ctx: HookContext): Promise<HookResult> {
    let text = message;
    let metadata: HookMetadata = {};

    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.transformOutgoing) {
            try {
                const result = await plugin.hooks.transformOutgoing(text, ctx);
                if (typeof result === 'string') {
                    text = result;
                } else {
                    text = result.text;
                    metadata = { ...metadata, ...result.metadata };
                }
            } catch (error) {
                logError(logger, error, 'Plugin transformOutgoing error', { pluginName: plugin.name });
            }
        }
    }

    return { text, metadata };
}

/**
 * Run all transformIncoming hooks on a message.
 */
export async function runIncomingHooks(message: string, ctx: HookContext): Promise<HookResult> {
    let text = message;
    let metadata: HookMetadata = {};

    for (const plugin of loadedPlugins) {
        if (plugin.hooks?.transformIncoming) {
            try {
                const result = await plugin.hooks.transformIncoming(text, ctx);
                if (typeof result === 'string') {
                    text = result;
                } else {
                    text = result.text;
                    metadata = { ...metadata, ...result.metadata };
                }
            } catch (error) {
                logError(logger, error, 'Plugin transformIncoming error', { pluginName: plugin.name });
            }
        }
    }

    return { text, metadata };
}

/**
 * Broadcast an event to all registered handlers.
 */
export function broadcastEvent(event: PluginEvent): void {
    // Call specific event type handlers
    const typeHandlers = eventHandlers.get(event.type) || [];
    for (const handler of typeHandlers) {
        try {
            handler(event);
        } catch (error) {
            logError(logger, error, 'Plugin event handler error', { eventType: event.type });
        }
    }

    // Call wildcard handlers
    const wildcardHandlers = eventHandlers.get('*') || [];
    for (const handler of wildcardHandlers) {
        try {
            handler(event);
        } catch (error) {
            logError(logger, error, 'Plugin wildcard handler error', { eventType: event.type });
        }
    }
}
