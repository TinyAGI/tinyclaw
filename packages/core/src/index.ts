#!/usr/bin/env node
/**
 * TinyClaw Core — Minimal message router.
 *
 * Receives messages via SQLite queue, routes to the correct agent, invokes the agent,
 * and enqueues the response. Team orchestration is handled by @tinyclaw/teams.
 */

import fs from 'fs';
import path from 'path';
import { MessageJobData } from './types';
import { getSettings, getAgents, getTeams, LOG_FILE, CHATS_DIR, FILES_DIR } from './config';
import { log, emitEvent } from './logging';
import { parseAgentRouting, findTeamForAgent, getAgentResetFlag } from './router';
import { invokeAgent } from './invoke';
import { loadPlugins, runIncomingHooks, runOutgoingHooks } from './plugins';
import { handleLongResponse, collectFiles } from './response';
import {
    initQueueDb, getPendingAgents, claimAllPendingMessages,
    completeMessage, failMessage, enqueueResponse,
    recoverStaleMessages, pruneAckedResponses, pruneCompletedMessages,
    closeQueueDb, queueEvents,
} from './queues';

// Ensure directories exist
[FILES_DIR, path.dirname(LOG_FILE), CHATS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

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

    // Route message to agent
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

    // Check for per-agent reset
    const agentResetFlag = getAgentResetFlag(agentId, workspacePath);
    const shouldReset = fs.existsSync(agentResetFlag);
    if (shouldReset) {
        fs.unlinkSync(agentResetFlag);
    }

    // Run incoming hooks
    ({ text: message } = await runIncomingHooks(message, { channel, sender, messageId, originalMessage: rawMessage }));

    // Invoke agent
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

    // Check if this agent is part of a team
    const teamContext = isTeamRouted
        ? (() => {
            for (const [tid, t] of Object.entries(teams)) {
                if (t.leader_agent === agentId && t.agents.includes(agentId)) {
                    return { teamId: tid, team: t };
                }
            }
            return findTeamForAgent(agentId, teams);
        })()
        : findTeamForAgent(agentId, teams);

    if (teamContext && !isInternal) {
        emitEvent('team_response', {
            agentId,
            response,
            teamId: teamContext.teamId,
            channel,
            sender,
            senderId: data.senderId || null,
            messageId,
            originalMessage: rawMessage,
            isTeamRouted,
        });
    }

    // Enqueue response for non-team or internal messages
    if (!teamContext || isInternal) {
        let finalResponse = response.trim();

        const outboundFilesSet = new Set<string>();
        collectFiles(finalResponse, outboundFilesSet);
        const outboundFiles = Array.from(outboundFilesSet);
        if (outboundFiles.length > 0) {
            finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
        }

        const { text: hookedResponse, metadata } = await runOutgoingHooks(finalResponse, { channel, sender, messageId, originalMessage: rawMessage });
        const { message: responseMessage, files: allFiles } = handleLongResponse(hookedResponse, outboundFiles);

        enqueueResponse({
            channel,
            sender,
            senderId: data.senderId,
            message: responseMessage,
            originalMessage: rawMessage,
            messageId,
            agent: agentId,
            files: allFiles.length > 0 ? allFiles : undefined,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        });

        log('INFO', `Response ready [${channel}] ${sender} via agent:${agentId} (${finalResponse.length} chars)`);
        emitEvent('response_ready', { channel, sender, agentId, responseLength: finalResponse.length, responseText: finalResponse, messageId });
    }
}

// Per-agent sequential processing chains
const agentChains = new Map<string, Promise<void>>();

async function processQueue(): Promise<void> {
    const pendingAgents = getPendingAgents();
    if (pendingAgents.length === 0) return;

    for (const agentId of pendingAgents) {
        const messages = claimAllPendingMessages(agentId);
        if (messages.length === 0) continue;

        // Chain processing per agent to avoid concurrent invocations of the same agent
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
    closeQueueDb();
    process.exit(0);
}

process.on('SIGINT', () => { shutdown(); });
process.on('SIGTERM', () => { shutdown(); });

// Re-export everything for other packages
export * from './types';
export * from './config';
export * from './logging';
export * from './router';
export * from './invoke';
export * from './plugins';
export * from './pairing';
export * from './response';
export * from './agent';
export * from './queues';
