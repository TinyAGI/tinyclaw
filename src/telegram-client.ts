#!/usr/bin/env node
/**
 * Telegram Client for TinyClaw Simple
 * Writes DM messages to queue and reads responses
 * Does NOT call Claude directly - that's handled by queue-processor
 *
 * Setup: Create a bot via @BotFather on Telegram to get a bot token.
 */

import TelegramBot from 'node-telegram-bot-api';
import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const SCRIPT_DIR = path.resolve(__dirname, '..');
const QUEUE_INCOMING = path.join(SCRIPT_DIR, '.tinyclaw/queue/incoming');
const QUEUE_OUTGOING = path.join(SCRIPT_DIR, '.tinyclaw/queue/outgoing');
const LOG_FILE = path.join(SCRIPT_DIR, '.tinyclaw/logs/telegram.log');
const SETTINGS_FILE = path.join(SCRIPT_DIR, '.tinyclaw/settings.json');

// Ensure directories exist
[QUEUE_INCOMING, QUEUE_OUTGOING, path.dirname(LOG_FILE)].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Validate bot token
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === 'your_token_here') {
    console.error('ERROR: TELEGRAM_BOT_TOKEN is not set in .env file');
    process.exit(1);
}

interface PendingMessage {
    chatId: number;
    messageId: number;
    timestamp: number;
}

interface QueueData {
    channel: string;
    sender: string;
    senderId: string;
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

// Track pending messages (waiting for response)
const pendingMessages = new Map<string, PendingMessage>();

// Logger
function log(level: string, message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    console.log(logMessage.trim());
    fs.appendFileSync(LOG_FILE, logMessage);
}

// Load agents from settings for /agents command
function getAgentListText(): string {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const settings = JSON.parse(settingsData);
        const agents = settings.agents;
        if (!agents || Object.keys(agents).length === 0) {
            return 'No agents configured. Using default single-agent mode.\n\nConfigure agents in .tinyclaw/settings.json or run: tinyclaw agent add';
        }
        let text = 'Available Agents:\n';
        for (const [id, agent] of Object.entries(agents) as [string, any][]) {
            text += `\n@${id} - ${agent.name}`;
            text += `\n  Provider: ${agent.provider}/${agent.model}`;
            text += `\n  Directory: ${agent.working_directory}`;
            if (agent.system_prompt) text += `\n  Has custom system prompt`;
            if (agent.prompt_file) text += `\n  Prompt file: ${agent.prompt_file}`;
        }
        text += '\n\nUsage: Start your message with @agent_id to route to a specific agent.';
        return text;
    } catch {
        return 'Could not load agent configuration.';
    }
}

// Split long messages for Telegram's 4096 char limit
function splitMessage(text: string, maxLength = 4096): string[] {
    if (text.length <= maxLength) {
        return [text];
    }

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        // Try to split at a newline boundary
        let splitIndex = remaining.lastIndexOf('\n', maxLength);

        // Fall back to space boundary
        if (splitIndex <= 0) {
            splitIndex = remaining.lastIndexOf(' ', maxLength);
        }

        // Hard-cut if no good boundary found
        if (splitIndex <= 0) {
            splitIndex = maxLength;
        }

        chunks.push(remaining.substring(0, splitIndex));
        remaining = remaining.substring(splitIndex).replace(/^\n/, '');
    }

    return chunks;
}

// Initialize Telegram bot (polling mode)
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Bot ready
bot.getMe().then((me) => {
    log('INFO', `Telegram bot connected as @${me.username}`);
    log('INFO', 'Listening for messages...');
}).catch((err) => {
    log('ERROR', `Failed to connect: ${err.message}`);
    process.exit(1);
});

// Message received - Write to queue
bot.on('message', async (msg) => {
    try {
        // Skip non-text messages
        if (!msg.text || msg.text.trim().length === 0) {
            return;
        }

        // Skip group/channel messages - only handle private chats
        if (msg.chat.type !== 'private') {
            return;
        }

        const sender = msg.from
            ? (msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : ''))
            : 'Unknown';
        const senderId = msg.from ? msg.from.id.toString() : msg.chat.id.toString();

        log('INFO', `Message from ${sender}: ${msg.text.substring(0, 50)}...`);

        // Check for agents list command
        if (msg.text.trim().match(/^[!/]agents$/i)) {
            log('INFO', 'Agents list command received');
            const agentList = getAgentListText();
            await bot.sendMessage(msg.chat.id, agentList, {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Check for reset command
        if (msg.text.trim().match(/^[!/]reset$/i)) {
            log('INFO', 'Reset command received');

            // Create reset flag
            const resetFlagPath = path.join(SCRIPT_DIR, '.tinyclaw/reset_flag');
            fs.writeFileSync(resetFlagPath, 'reset');

            // Reply immediately
            await bot.sendMessage(msg.chat.id, 'Conversation reset! Next message will start a fresh conversation.', {
                reply_to_message_id: msg.message_id,
            });
            return;
        }

        // Show typing indicator
        await bot.sendChatAction(msg.chat.id, 'typing');

        // Generate unique message ID
        const queueMessageId = `${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Write to incoming queue
        const queueData: QueueData = {
            channel: 'telegram',
            sender: sender,
            senderId: senderId,
            message: msg.text,
            timestamp: Date.now(),
            messageId: queueMessageId,
        };

        const queueFile = path.join(QUEUE_INCOMING, `telegram_${queueMessageId}.json`);
        fs.writeFileSync(queueFile, JSON.stringify(queueData, null, 2));

        log('INFO', `Queued message ${queueMessageId}`);

        // Store pending message for response
        pendingMessages.set(queueMessageId, {
            chatId: msg.chat.id,
            messageId: msg.message_id,
            timestamp: Date.now(),
        });

        // Clean up old pending messages (older than 5 minutes)
        const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
        for (const [id, data] of pendingMessages.entries()) {
            if (data.timestamp < fiveMinutesAgo) {
                pendingMessages.delete(id);
            }
        }

    } catch (error) {
        log('ERROR', `Message handling error: ${(error as Error).message}`);
    }
});

// Watch for responses in outgoing queue
function checkOutgoingQueue(): void {
    try {
        const files = fs.readdirSync(QUEUE_OUTGOING)
            .filter(f => f.startsWith('telegram_') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(QUEUE_OUTGOING, file);

            try {
                const responseData: ResponseData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const { messageId, message: responseText, sender } = responseData;

                // Find pending message
                const pending = pendingMessages.get(messageId);
                if (pending) {
                    // Split message if needed (Telegram 4096 char limit)
                    const chunks = splitMessage(responseText);

                    // First chunk as reply, rest as follow-up messages
                    bot.sendMessage(pending.chatId, chunks[0], {
                        reply_to_message_id: pending.messageId,
                    });
                    for (let i = 1; i < chunks.length; i++) {
                        bot.sendMessage(pending.chatId, chunks[i]);
                    }

                    log('INFO', `Sent response to ${sender} (${responseText.length} chars, ${chunks.length} message(s))`);

                    // Clean up
                    pendingMessages.delete(messageId);
                    fs.unlinkSync(filePath);
                } else {
                    // Message too old or already processed
                    log('WARN', `No pending message for ${messageId}, cleaning up`);
                    fs.unlinkSync(filePath);
                }
            } catch (error) {
                log('ERROR', `Error processing response file ${file}: ${(error as Error).message}`);
                // Don't delete file on error, might retry
            }
        }
    } catch (error) {
        log('ERROR', `Outgoing queue error: ${(error as Error).message}`);
    }
}

// Check outgoing queue every second
setInterval(checkOutgoingQueue, 1000);

// Refresh typing indicator every 4 seconds for pending messages
setInterval(() => {
    for (const [, data] of pendingMessages.entries()) {
        bot.sendChatAction(data.chatId, 'typing').catch(() => {
            // Ignore typing errors silently
        });
    }
}, 4000);

// Handle polling errors
bot.on('polling_error', (error) => {
    log('ERROR', `Polling error: ${error.message}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    log('INFO', 'Shutting down Telegram client...');
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', () => {
    log('INFO', 'Shutting down Telegram client...');
    bot.stopPolling();
    process.exit(0);
});

// Start
log('INFO', 'Starting Telegram client...');
