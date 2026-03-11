#!/usr/bin/env node
/**
 * TinyClaw Queue Processor — Entry point.
 *
 * Initializes the SQLite queue, starts the API server, processes messages,
 * and manages lifecycle. This is the only file that should be run directly.
 */

import fs from 'fs';
import path from 'path';
import {
    Conversation, TeamConfig, MessageJobData,
    getSettings, getAgents, getTeams, LOG_FILE, CHATS_DIR, FILES_DIR,
    log, emitEvent,
    parseAgentRouting, findTeamForAgent, getAgentResetFlag,
    invokeAgent,
    loadPlugins, runIncomingHooks, runOutgoingHooks,
    handleLongResponse, collectFiles,
    initQueueDb, getPendingAgents, claimAllPendingMessages,
    completeMessage, failMessage, enqueueResponse,
    recoverStaleMessages, pruneAckedResponses, pruneCompletedMessages,
    closeQueueDb, queueEvents,
} from '@tinyclaw/core';
import { startApiServer } from '@tinyclaw/server';
import {
    conversations, MAX_CONVERSATION_MESSAGES,
    withConversationLock, incrementPending, decrementPending,
    enqueueInternalMessage, postToChatRoom, completeConversation,
    extractTeammateMentions, extractChatRoomMessages,
} from '@tinyclaw/teams';

// Ensure directories exist
[FILES_DIR, path.dirname(LOG_FILE), CHATS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

// ── Message Processing ──────────────────────────────────────────────────────

async function processMessage(dbMsg: any): Promise<void> {
    const data: MessageJobData = {
        channel: dbMsg.channel,
        sender: dbMsg.sender,
        senderId: dbMsg.sender_id,
        message: dbMsg.message,
        messageId: dbMsg.message_id,
        agent: dbMsg.agent ?? undefined,
        files: dbMsg.files ? JSON.parse(dbMsg.files) : undefined,
        conversationId: dbMsg.conversation_id ?? undefined,
        fromAgent: dbMsg.from_agent ?? undefined,
    };

    const { channel, sender, message: rawMessage, messageId, agent: preRoutedAgent } = data;
    const isInternal = !!data.conversationId;

    log('INFO', `Processing [${isInternal ? 'internal' : channel}] ${isInternal ? `@${data.fromAgent}→@${preRoutedAgent}` : `from ${sender}`}: ${rawMessage.substring(0, 50)}...`);
    if (!isInternal) {
        emitEvent('message_received', { channel, sender, message: rawMessage.substring(0, 120), messageId });
    }

    const settings = getSettings();
    const agents = getAgents(settings);
    const teams = getTeams(settings);
    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');

    // ── Route message to agent ──────────────────────────────────────────────
    let agentId: string;
    let message: string;
    let isTeamRouted = false;

    if (preRoutedAgent && agents[preRoutedAgent]) {
        agentId = preRoutedAgent;
        message = rawMessage;
    } else {
        const routing = parseAgentRouting(rawMessage, agents, teams);
        agentId = routing.agentId;
        message = routing.message;
        isTeamRouted = !!routing.isTeam;
    }

    if (!agents[agentId]) {
        agentId = 'default';
        message = rawMessage;
    }
    if (!agents[agentId]) {
        agentId = Object.keys(agents)[0];
    }

    const agent = agents[agentId];
    log('INFO', `Routing to agent: ${agent.name} (${agentId}) [${agent.provider}/${agent.model}]`);
    if (!isInternal) {
        emitEvent('agent_routed', { agentId, agentName: agent.name, provider: agent.provider, model: agent.model, isTeamRouted });
    }

    // ── Invoke agent ────────────────────────────────────────────────────────
    const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
    const shouldReset = fs.existsSync(agentResetFlag);
    if (shouldReset) {
        fs.unlinkSync(agentResetFlag);
    }

    ({ text: message } = await runIncomingHooks(message, { channel, sender, messageId, originalMessage: rawMessage }));

    emitEvent('chain_step_start', { agentId, agentName: agent.name, fromAgent: data.fromAgent || null });
    let response: string;
    try {
        response = await invokeAgent(agent, agentId, message, workspacePath, shouldReset, agents, teams);
    } catch (error) {
        const provider = agent.provider || 'anthropic';
        const providerLabel = provider === 'openai' ? 'Codex' : provider === 'opencode' ? 'OpenCode' : 'Claude';
        log('ERROR', `${providerLabel} error (agent: ${agentId}): ${(error as Error).message}`);
        response = "Sorry, I encountered an error processing your request. Please check the queue logs.";
    }
    emitEvent('chain_step_done', { agentId, agentName: agent.name, responseLength: response.length, responseText: response });

    // Extract and post [#team_id: message] chat room broadcasts
    const chatRoomMsgs = extractChatRoomMessages(response, agentId, teams);
    for (const crMsg of chatRoomMsgs) {
        postToChatRoom(crMsg.teamId, agentId, crMsg.message, teams[crMsg.teamId].agents, {
            channel, sender, senderId: data.senderId, messageId,
        });
    }

    // ── Response routing ────────────────────────────────────────────────────
    //
    // Three paths based on how the message arrived:
    //
    //   1. Direct     — user addressed a specific agent ("@coder hi").
    //                   Response goes straight back to the user.
    //
    //   2. Team-routed — user addressed a team ("@dev fix the bug").
    //                   Starts a team conversation. The leader may delegate
    //                   to teammates via [@agent: message] mentions.
    //
    //   3. Internal   — agent-to-agent within a team conversation.
    //                   Response is added to the conversation. If more
    //                   teammates are mentioned, they get enqueued. When all
    //                   branches resolve, the aggregated response goes to user.

    if (!isTeamRouted && !isInternal) {
        // ── Path 1: Direct response to user ─────────────────────────────────
        await sendDirectResponse(response, {
            channel, sender, senderId: data.senderId,
            messageId, originalMessage: rawMessage, agentId,
        });
        return;
    }

    // ── Path 2 & 3: Team conversation ───────────────────────────────────────
    const teamContext = resolveTeamContext(agentId, isTeamRouted, data, teams);
    if (!teamContext) {
        // Team routing resolved but no team found — fall back to direct
        await sendDirectResponse(response, {
            channel, sender, senderId: data.senderId,
            messageId, originalMessage: rawMessage, agentId,
        });
        return;
    }

    // Get or create conversation
    let conv: Conversation;
    if (isInternal && data.conversationId && conversations.has(data.conversationId)) {
        conv = conversations.get(data.conversationId)!;
    } else {
        const convId = `${messageId}_${Date.now()}`;
        conv = {
            id: convId,
            channel,
            sender,
            originalMessage: rawMessage,
            messageId,
            pending: 1,
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
        log('INFO', `Conversation started: ${convId} (team: ${teamContext.team.name})`);
        emitEvent('team_chain_start', { teamId: teamContext.teamId, teamName: teamContext.team.name, agents: teamContext.team.agents, leader: teamContext.team.leader_agent });
    }

    // Record this agent's response
    conv.responses.push({ agentId, response });
    conv.totalMessages++;
    conv.pendingAgents.delete(agentId);
    collectFiles(response, conv.files);

    // Check for teammate mentions — forward to teammates if under message limit
    const teammateMentions = extractTeammateMentions(response, agentId, conv.teamContext.teamId, teams, agents);

    if (teammateMentions.length > 0 && conv.totalMessages < conv.maxMessages) {
        incrementPending(conv, teammateMentions.length);
        conv.outgoingMentions.set(agentId, teammateMentions.length);

        for (const mention of teammateMentions) {
            conv.pendingAgents.add(mention.teammateId);
            log('INFO', `@${agentId} → @${mention.teammateId}`);
            emitEvent('chain_handoff', { teamId: conv.teamContext.teamId, fromAgent: agentId, toAgent: mention.teammateId });

            const internalMsg = `[Message from teammate @${agentId}]:\n${mention.message}`;
            enqueueInternalMessage(conv.id, agentId, mention.teammateId, internalMsg, {
                channel, sender, senderId: data.senderId, messageId,
            });
        }
    } else if (teammateMentions.length > 0) {
        log('WARN', `Conversation ${conv.id} hit max messages (${conv.maxMessages}) — not enqueuing further mentions`);
    }

    // Decrement pending — if all branches resolved, complete the conversation
    await withConversationLock(conv.id, async () => {
        const shouldComplete = decrementPending(conv);
        if (shouldComplete) {
            completeConversation(conv);
        } else {
            log('INFO', `Conversation ${conv.id}: ${conv.pending} branch(es) still pending`);
        }
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveTeamContext(
    agentId: string,
    isTeamRouted: boolean,
    data: MessageJobData,
    teams: Record<string, TeamConfig>
): { teamId: string; team: TeamConfig } | null {
    // Internal messages inherit team context from their conversation
    if (data.conversationId) {
        const conv = conversations.get(data.conversationId);
        if (conv) return conv.teamContext;
    }
    // Team-routed: prefer the team where this agent is leader
    if (isTeamRouted) {
        for (const [tid, t] of Object.entries(teams)) {
            if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                return { teamId: tid, team: t };
            }
        }
    }
    return findTeamForAgent(agentId, teams);
}

async function sendDirectResponse(
    response: string,
    ctx: { channel: string; sender: string; senderId?: string | null; messageId: string; originalMessage: string; agentId: string }
): Promise<void> {
    let finalResponse = response.trim();

    const outboundFilesSet = new Set<string>();
    collectFiles(finalResponse, outboundFilesSet);
    const outboundFiles = Array.from(outboundFilesSet);
    if (outboundFiles.length > 0) {
        finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
    }

    const { text: hookedResponse, metadata } = await runOutgoingHooks(finalResponse, {
        channel: ctx.channel, sender: ctx.sender, messageId: ctx.messageId, originalMessage: ctx.originalMessage,
    });
    const { message: responseMessage, files: allFiles } = handleLongResponse(hookedResponse, outboundFiles);

    enqueueResponse({
        channel: ctx.channel,
        sender: ctx.sender,
        senderId: ctx.senderId ?? undefined,
        message: responseMessage,
        originalMessage: ctx.originalMessage,
        messageId: ctx.messageId,
        agent: ctx.agentId,
        files: allFiles.length > 0 ? allFiles : undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    log('INFO', `Response ready [${ctx.channel}] ${ctx.sender} via agent:${ctx.agentId} (${finalResponse.length} chars)`);
    emitEvent('response_ready', { channel: ctx.channel, sender: ctx.sender, agentId: ctx.agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId: ctx.messageId });
}

// ── Queue Processing ────────────────────────────────────────────────────────

const agentChains = new Map<string, Promise<void>>();

async function processQueue(): Promise<void> {
    const pendingAgents = getPendingAgents();
    if (pendingAgents.length === 0) return;

    for (const agentId of pendingAgents) {
        const messages = claimAllPendingMessages(agentId);
        if (messages.length === 0) continue;

        const currentChain = agentChains.get(agentId) || Promise.resolve();
        const newChain = currentChain.then(async () => {
            for (const msg of messages) {
                try {
                    await processMessage(msg);
                    completeMessage(msg.id);
                } catch (error) {
                    log('ERROR', `Failed to process message ${msg.id}: ${(error as Error).message}`);
                    failMessage(msg.id, (error as Error).message);
                }
            }
        });
        agentChains.set(agentId, newChain);
        newChain.finally(() => {
            if (agentChains.get(agentId) === newChain) {
                agentChains.delete(agentId);
            }
        });
    }
}

function logAgentConfig(): void {
    const settings = getSettings();
    const agents = getAgents(settings);
    const teams = getTeams(settings);

    const agentCount = Object.keys(agents).length;
    log('INFO', `Loaded ${agentCount} agent(s):`);
    for (const [id, agent] of Object.entries(agents)) {
        log('INFO', `  ${id}: ${agent.name} [${agent.provider}/${agent.model}] cwd=${agent.working_directory}`);
    }

    const teamCount = Object.keys(teams).length;
    if (teamCount > 0) {
        log('INFO', `Loaded ${teamCount} team(s):`);
        for (const [id, team] of Object.entries(teams)) {
            log('INFO', `  ${id}: ${team.name} [agents: ${team.agents.join(', ')}] leader=${team.leader_agent}`);
        }
    }
}

// ─── Start ──────────────────────────────────────────────────────────────────

initQueueDb();

const apiServer = startApiServer(conversations);

// Event-driven: process queue when a new message arrives
queueEvents.on('message:enqueued', () => processQueue());

// Also poll periodically in case events are missed
const pollInterval = setInterval(() => processQueue(), 5000);

// Periodic maintenance
const maintenanceInterval = setInterval(() => {
    const recovered = recoverStaleMessages();
    if (recovered > 0) log('INFO', `Recovered ${recovered} stale message(s)`);
    pruneAckedResponses();
    pruneCompletedMessages();
}, 60 * 1000);

// Load plugins
(async () => {
    await loadPlugins();
})();

log('INFO', 'Queue processor started (SQLite)');
logAgentConfig();
emitEvent('processor_start', { agents: Object.keys(getAgents(getSettings())), teams: Object.keys(getTeams(getSettings())) });

// Graceful shutdown
function shutdown(): void {
    log('INFO', 'Shutting down queue processor...');
    clearInterval(pollInterval);
    clearInterval(maintenanceInterval);
    apiServer.close();
    closeQueueDb();
    process.exit(0);
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });
