#!/usr/bin/env node
/**
 * Queue Processor - Handles messages from all channels (WhatsApp, Telegram, etc.)
 *
 * Supports multi-agent routing:
 *   - Messages prefixed with @agent_id are routed to that agent
 *   - Unrouted messages go to the "default" agent
 *   - Each agent has its own provider, model, working directory, and system prompt
 *   - Conversation isolation via per-agent working directories
 *
 * Team conversations use queue-based message passing:
 *   - Agent mentions ([@teammate: message]) become new messages in the queue
 *   - Each agent processes messages naturally via its own promise chain
 *   - Conversations complete when all branches resolve (no more pending mentions)
 */

import fs from 'fs';
import path from 'path';
import { MessageData, Conversation, TeamConfig } from './lib/types';
import {
    LOG_FILE, CHATS_DIR, FILES_DIR,
    getSettings, getAgents, getTeams
} from './lib/config';
import { emitEvent } from './lib/events';
import { createLogger, excerptText, isDebugEnabled, logError } from './lib/logging';
import { parseAgentRouting, findTeamForAgent, getAgentResetFlag, extractTeammateMentions } from './lib/routing';
import { invokeAgent } from './lib/invoke';
import { loadPlugins, runIncomingHooks, runOutgoingHooks } from './lib/plugins';
import { startApiServer } from './server';
import {
    initQueueDb, claimNextMessage, completeMessage as dbCompleteMessage,
    failMessage, enqueueResponse, getPendingAgents, recoverStaleMessages,
    pruneAckedResponses, pruneCompletedMessages, closeQueueDb, queueEvents, DbMessage,
} from './lib/db';
import { handleLongResponse, collectFiles } from './lib/response';
import {
    conversations, MAX_CONVERSATION_MESSAGES, enqueueInternalMessage, completeConversation,
    withConversationLock, incrementPending, decrementPending,
} from './lib/conversation';

const logger = createLogger({ runtime: 'queue', source: 'queue', component: 'processor' });

// Ensure directories exist
[FILES_DIR, path.dirname(LOG_FILE), CHATS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// Process a single message from the DB
async function processMessage(dbMsg: DbMessage): Promise<void> {
    try {
        const channel = dbMsg.channel;
        const sender = dbMsg.sender;
        const rawMessage = dbMsg.message;
        const messageId = dbMsg.message_id;
        const isInternal = !!dbMsg.conversation_id;
        const files: string[] = dbMsg.files ? JSON.parse(dbMsg.files) : [];

        // Build a MessageData-like object for compatibility
        const messageData: MessageData = {
            channel,
            sender,
            senderId: dbMsg.sender_id ?? undefined,
            message: rawMessage,
            timestamp: dbMsg.created_at,
            messageId,
            agent: dbMsg.agent ?? undefined,
            files: files.length > 0 ? files : undefined,
            conversationId: dbMsg.conversation_id ?? undefined,
            fromAgent: dbMsg.from_agent ?? undefined,
        };

        const processingBindings: Record<string, unknown> = {
            channel,
            sender,
            messageId,
            conversationId: messageData.conversationId,
            fromAgent: messageData.fromAgent,
            toAgent: dbMsg.agent ?? undefined,
        };
        if (isDebugEnabled(logger)) {
            processingBindings.excerpt = excerptText(rawMessage);
        }
        logger.info(processingBindings, isInternal ? 'Processing internal message' : 'Processing inbound message');
        if (!isInternal) {
            emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId });
        }

        // Get settings, agents, and teams
        const settings = getSettings();
        const agents = getAgents(settings);
        const teams = getTeams(settings);

        // Get workspace path from settings
        const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');

        // Route message to agent (or team)
        let agentId: string;
        let message: string;
        let isTeamRouted = false;

        if (messageData.agent && agents[messageData.agent]) {
            // Pre-routed (by channel client or internal message)
            agentId = messageData.agent;
            message = rawMessage;
        } else {
            // Parse @agent or @team prefix
            const routing = parseAgentRouting(rawMessage, agents, teams);
            agentId = routing.agentId;
            message = routing.message;
            isTeamRouted = !!routing.isTeam;
        }

        // Fall back to default if agent not found
        if (!agents[agentId]) {
            agentId = 'default';
            message = rawMessage;
        }

        // Final fallback: use first available agent if no default
        if (!agents[agentId]) {
            agentId = Object.keys(agents)[0];
        }

        const agent = agents[agentId];
        logger.info({
            channel,
            sender,
            messageId,
            agentId,
            context: { agentName: agent.name, provider: agent.provider, model: agent.model },
        }, 'Routing to agent');
        if (!isInternal) {
            emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted });
        }

        // Determine team context
        let teamContext: { teamId: string; team: TeamConfig } | null = null;
        if (isInternal) {
            // Internal messages inherit team context from their conversation
            const conv = conversations.get(messageData.conversationId!);
            if (conv) teamContext = conv.teamContext;
        } else {
            if (isTeamRouted) {
                for (const [tid, t] of Object.entries(teams)) {
                    if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                        teamContext = { teamId: tid, team: t };
                        break;
                    }
                }
            }
            if (!teamContext) {
                teamContext = findTeamForAgent(agentId, teams);
            }
        }

        // Check for per-agent reset
        const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
        const shouldReset = fs.existsSync(agentResetFlag);

        if (shouldReset) {
            fs.unlinkSync(agentResetFlag);
        }

        // For internal messages: append pending response indicator so the agent
        // knows other teammates are still processing and won't re-mention them.
        if (isInternal && messageData.conversationId) {
            const conv = conversations.get(messageData.conversationId);
            if (conv) {
                // Count agents that have been enqueued but haven't responded yet, excluding this agent
                const respondedAgents = new Set(conv.responses.map(r => r.agentId));
                const othersPending = [...conv.pendingAgents].filter(a => a !== agentId && !respondedAgents.has(a)).length;
                if (othersPending > 0) {
                    message += `\n\n------\n\n[${othersPending} other teammate response(s) are still being processed and will be delivered when ready. Do not re-mention teammates who haven't responded yet.]`;
                }
            }
        }

        // Run incoming hooks
        ({ text: message } = await runIncomingHooks(message, { channel, sender, messageId, originalMessage: rawMessage }));

        // Invoke agent
        emitEvent('chain_step_start', { agentId, agentName: agent.name, fromAgent: messageData.fromAgent || null });
        let response: string;
        try {
            response = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams);
        } catch (error) {
            const provider = agent.provider || 'anthropic';
            const providerLabel = provider === 'openai' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
            logError(logger, error, `${providerLabel} error during agent invocation`, {
                agentId,
                channel,
                sender,
                messageId,
            });
            response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
        }

        emitEvent('chain_step_done', { agentId, agentName: agent.name, responseLength: response.length, responseText: response });

        // --- No team context: simple response to user ---
        if (!teamContext) {
            let finalResponse = response.trim();

            // Detect files
            const outboundFilesSet = new Set<string>();
            collectFiles(finalResponse, outboundFilesSet);
            const outboundFiles = Array.from(outboundFilesSet);
            if (outboundFiles.length > 0) {
                finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
            }

            // Run outgoing hooks
            const { text: hookedResponse, metadata } = await runOutgoingHooks(finalResponse, { channel, sender, messageId, originalMessage: rawMessage });

            // Handle long responses — send as file attachment
            const { message: responseMessage, files: allFiles } = handleLongResponse(hookedResponse, outboundFiles);

            enqueueResponse({
                channel,
                sender,
                senderId: dbMsg.sender_id ?? undefined,
                message: responseMessage,
                originalMessage: rawMessage,
                messageId,
                agent: agentId,
                files: allFiles.length > 0 ? allFiles : undefined,
                metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
            });

            logger.info({
                channel,
                sender,
                messageId,
                agentId,
                context: { responseLength: finalResponse.length },
            }, 'Response ready');
            emitEvent('response_ready', { channel, sender, agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId });

            dbCompleteMessage(dbMsg.id);
            return;
        }

        // --- Team context: conversation-based message passing ---

        // Get or create conversation
        let conv: Conversation;
        if (isInternal && messageData.conversationId && conversations.has(messageData.conversationId)) {
            conv = conversations.get(messageData.conversationId)!;
        } else {
            // New conversation
            const convId = `${messageId}_${Date.now()}`;
            conv = {
                id: convId,
                channel,
                sender,
                originalMessage: rawMessage,
                messageId,
                pending: 1, // this initial message
                responses: [],
                files: new Set(),
                totalMessages: 0,
                maxMessages: MAX_CONVERSATION_MESSAGES,
                teamContext,
                startTime: Date.now(),
                outgoingMentions: new Map(),
                pendingAgents: new Set([agentId]),
            };
            conversations.set(convId, conv);
            logger.info({
                conversationId: convId,
                channel,
                sender,
                messageId,
                teamId: teamContext.teamId,
                context: { teamName: teamContext.team.name },
            }, 'Conversation started');
            emitEvent('team_chain_start', { teamId: teamContext.teamId, teamName: teamContext.team.name, agents: teamContext.team.agents, leader: teamContext.team.leader_agent });
        }

        // Record this agent's response
        conv.responses.push({ agentId, response });
        conv.totalMessages++;
        conv.pendingAgents.delete(agentId);
        collectFiles(response, conv.files);

        // Check for teammate mentions
        const teammateMentions = extractTeammateMentions(
            response, agentId, conv.teamContext.teamId, teams, agents
        );

        if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
            // Enqueue internal messages for each mention
            incrementPending(conv, teammateMentions.length);
            conv.outgoingMentions.set(agentId, teammateMentions.length);
            for (const mention of teammateMentions) {
                conv.pendingAgents.add(mention.teammateId);
                const handoffBindings: Record<string, unknown> = {
                    conversationId: conv.id,
                    channel: messageData.channel,
                    messageId: messageData.messageId,
                    teamId: conv.teamContext.teamId,
                    fromAgent: agentId,
                    toAgent: mention.teammateId,
                };
                if (isDebugEnabled(logger)) {
                    handoffBindings.excerpt = excerptText(mention.message);
                }
                logger.info(handoffBindings, 'Agent handoff queued');
                emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

                const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
                enqueueInternalMessage(conv.id, agentId, mention.teammateId, internalMsg, {
                    channel: messageData.channel,
                    sender: messageData.sender,
                    senderId: messageData.senderId,
                    messageId: messageData.messageId,
                });
            }
        } else if (teammateMentions.length > 0) {
            logger.warn({
                conversationId: conv.id,
                teamId: conv.teamContext.teamId,
                context: { maxMessages: conv.maxMessages },
            }, 'Conversation hit max messages; skipping further mentions');
        }

        // This branch is done - use atomic decrement with locking
        await withConversationLock(conv.id, async () => {
            const shouldComplete = decrementPending(conv);

            if (shouldComplete) {
                completeConversation(conv);
            } else {
                logger.info({ conversationId: conv.id, context: { pending: conv.pending } }, 'Conversation branches still pending');
            }
        });

        // Mark message as completed in DB
        dbCompleteMessage(dbMsg.id);

    } catch (error) {
        logError(logger, error, 'Processing error', {
            channel: dbMsg.channel,
            sender: dbMsg.sender,
            messageId: dbMsg.message_id,
            conversationId: dbMsg.conversation_id ?? undefined,
            agentId: dbMsg.agent ?? undefined,
        });
        failMessage(dbMsg.id, (error as Error).message);
    }
}

// Per-agent processing chains - ensures messages to same agent are sequential
const agentProcessingChains = new Map<string, Promise<void>>();
let drainScheduled = false;

function scheduleQueueDrain(): void {
    if (drainScheduled) return;
    drainScheduled = true;

    queueMicrotask(() => {
        drainScheduled = false;
        void processQueue();
    });
}

// Main processing loop
async function processQueue(): Promise<void> {
    try {
        // Get all agents with pending messages
        const pendingAgents = getPendingAgents();

        if (pendingAgents.length === 0) return;

        for (const agentId of pendingAgents) {
            // Claim next message for this agent
            const dbMsg = claimNextMessage(agentId);
            if (!dbMsg) continue;

            // Get or create promise chain for this agent
            const currentChain = agentProcessingChains.get(agentId) || Promise.resolve();

            // Chain this message to the agent's promise
            const newChain = currentChain
                .then(() => processMessage(dbMsg))
                .catch(error => {
                    logError(logger, error, 'Error processing message for agent', { agentId });
                });

            // Update the chain
            agentProcessingChains.set(agentId, newChain);

            // Clean up completed chains to avoid memory leaks
            newChain.finally(() => {
                if (agentProcessingChains.get(agentId) === newChain) {
                    agentProcessingChains.delete(agentId);
                }

                // Keep draining until the backlog for this agent is exhausted.
                scheduleQueueDrain();
            });
        }
    } catch (error) {
        logError(logger, error, 'Queue processing error');
    }
}

// Log agent and team configuration on startup
function logAgentConfig(): void {
    const settings = getSettings();
    const agents = getAgents(settings);
    const teams = getTeams(settings);

    const agentCount = Object.keys(agents).length;
    logger.info({ context: { agentCount } }, 'Loaded agents');
    for (const [id, agent] of Object.entries(agents)) {
        logger.info({
            agentId: id,
            context: {
                agentName: agent.name,
                provider: agent.provider,
                model: agent.model,
                workingDirectory: agent.working_directory,
            },
        }, 'Agent configuration loaded');
    }

    const teamCount = Object.keys(teams).length;
    if (teamCount > 0) {
        logger.info({ context: { teamCount } }, 'Loaded teams');
        for (const [id, team] of Object.entries(teams)) {
            logger.info({
                teamId: id,
                context: { teamName: team.name, agents: team.agents, leader: team.leader_agent },
            }, 'Team configuration loaded');
        }
    }
}

// ─── Start ──────────────────────────────────────────────────────────────────

// Initialize SQLite queue
initQueueDb();

// Recover stale messages from previous crash
const recovered = recoverStaleMessages();
if (recovered > 0) {
    logger.info({ context: { recovered } }, 'Recovered stale messages from previous session');
}

// Start the API server (passes conversations for queue status reporting)
const apiServer = startApiServer(conversations);

// Load plugins (async IIFE to avoid top-level await)
(async () => {
    await loadPlugins();
})();

logger.info('Queue processor started (SQLite-backed)');
logAgentConfig();
emitEvent('processor_start', { agents: Object.keys(getAgents(getSettings())), teams: Object.keys(getTeams(getSettings())) });

// Drain any backlog already present at startup, even when nothing was recovered.
scheduleQueueDrain();

// Event-driven: all messages come through the API server (same process)
queueEvents.on('message:enqueued', () => scheduleQueueDrain());

// Periodic maintenance
setInterval(() => {
    const count = recoverStaleMessages();
    if (count > 0) {
        logger.info({ context: { recovered: count } }, 'Recovered stale messages');
        scheduleQueueDrain();
    }
}, 5 * 60 * 1000); // every 5 min

setInterval(() => {
    // Clean up old conversations (TTL: 30 min)
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, conv] of conversations.entries()) {
        if (conv.startTime < cutoff) {
            logger.warn({ conversationId: id }, 'Conversation timed out after 30 minutes; cleaning up');
            conversations.delete(id);
        }
    }
}, 30 * 60 * 1000); // every 30 min

setInterval(() => {
    const pruned = pruneAckedResponses();
    if (pruned > 0) logger.info({ context: { pruned } }, 'Pruned acked responses');
}, 60 * 60 * 1000); // every 1 hr

setInterval(() => {
    const pruned = pruneCompletedMessages();
    if (pruned > 0) logger.info({ context: { pruned } }, 'Pruned completed messages');
}, 60 * 60 * 1000); // every 1 hr

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('Shutting down queue processor');
    closeQueueDb();
    apiServer.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Shutting down queue processor');
    closeQueueDb();
    apiServer.close();
    process.exit(0);
});
