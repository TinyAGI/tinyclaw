import fs from 'fs';
import path from 'path';
import { Conversation } from './types';
import { CHATS_DIR, getSettings, getAgents } from './config';
import { log, emitEvent } from './logging';
import { enqueueMessage, enqueueResponse } from './db';
import { handleLongResponse, collectFiles } from './response';

// Active conversations — tracks in-flight team message passing
export const conversations = new Map<string, Conversation>();

export const MAX_CONVERSATION_MESSAGES = 50;

/**
 * Enqueue an internal (agent-to-agent) message into the SQLite queue.
 */
export function enqueueInternalMessage(
    conversationId: string,
    fromAgent: string,
    targetAgent: string,
    message: string,
    originalData: { channel: string; sender: string; senderId?: string | null; messageId: string }
): void {
    const messageId = `internal_${conversationId}_${targetAgent}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    enqueueMessage({
        channel: originalData.channel,
        sender: originalData.sender,
        senderId: originalData.senderId ?? undefined,
        message,
        messageId,
        agent: targetAgent,
        conversationId,
        fromAgent,
    });
    log('INFO', `Enqueued internal message: @${fromAgent} → @${targetAgent}`);
}

/**
 * Complete a conversation: aggregate responses, write to outgoing queue, save chat history.
 */
export function completeConversation(conv: Conversation): void {
    const settings = getSettings();
    const agents = getAgents(settings);

    log('INFO', `Conversation ${conv.id} complete — ${conv.responses.length} response(s), ${conv.totalMessages} total message(s)`);
    emitEvent('team_chain_end', {
        teamId: conv.teamContext.teamId,
        totalSteps: conv.responses.length,
        agents: conv.responses.map(s => s.agentId),
    });

    // Aggregate responses
    let finalResponse: string;
    if (conv.responses.length === 1) {
        finalResponse = conv.responses[0].response;
    } else {
        finalResponse = conv.responses
            .map(step => `@${step.agentId}: ${step.response}`)
            .join('\n\n------\n\n');
    }

    // Save chat history
    try {
        const teamChatsDir = path.join(CHATS_DIR, conv.teamContext.teamId);
        if (!fs.existsSync(teamChatsDir)) {
            fs.mkdirSync(teamChatsDir, { recursive: true });
        }
        const chatLines: string[] = [];
        chatLines.push(`# Team Conversation: ${conv.teamContext.team.name} (@${conv.teamContext.teamId})`);
        chatLines.push(`**Date:** ${new Date().toISOString()}`);
        chatLines.push(`**Channel:** ${conv.channel} | **Sender:** ${conv.sender}`);
        chatLines.push(`**Messages:** ${conv.totalMessages}`);
        chatLines.push('');
        chatLines.push('------');
        chatLines.push('');
        chatLines.push(`## User Message`);
        chatLines.push('');
        chatLines.push(conv.originalMessage);
        chatLines.push('');
        for (let i = 0; i < conv.responses.length; i++) {
            const step = conv.responses[i];
            const stepAgent = agents[step.agentId];
            const stepLabel = stepAgent ? `${stepAgent.name} (@${step.agentId})` : `@${step.agentId}`;
            chatLines.push('------');
            chatLines.push('');
            chatLines.push(`## ${stepLabel}`);
            chatLines.push('');
            chatLines.push(step.response);
            chatLines.push('');
        }
        const now = new Date();
        const dateTime = now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '');
        fs.writeFileSync(path.join(teamChatsDir, `${dateTime}.md`), chatLines.join('\n'));
        log('INFO', `Chat history saved`);
    } catch (e) {
        log('ERROR', `Failed to save chat history: ${(e as Error).message}`);
    }

    // Detect file references
    finalResponse = finalResponse.trim();
    const outboundFilesSet = new Set<string>(conv.files);
    collectFiles(finalResponse, outboundFilesSet);
    const outboundFiles = Array.from(outboundFilesSet);

    // Remove [send_file: ...] tags
    if (outboundFiles.length > 0) {
        finalResponse = finalResponse.replace(/\[send_file:\s*[^\]]+\]/g, '').trim();
    }

    // Remove [@agent: ...] tags from final response
    finalResponse = finalResponse.replace(/\[@\S+?:\s*[\s\S]*?\]/g, '').trim();

    // Handle long responses — send as file attachment
    const { message: responseMessage, files: allFiles } = handleLongResponse(finalResponse, outboundFiles);

    // Write to outgoing queue
    enqueueResponse({
        channel: conv.channel,
        sender: conv.sender,
        message: responseMessage,
        originalMessage: conv.originalMessage,
        messageId: conv.messageId,
        files: allFiles.length > 0 ? allFiles : undefined,
    });

    log('INFO', `✓ Response ready [${conv.channel}] ${conv.sender} (${finalResponse.length} chars)`);
    emitEvent('response_ready', { channel: conv.channel, sender: conv.sender, responseLength: finalResponse.length, responseText: finalResponse, messageId: conv.messageId });

    // Clean up
    conversations.delete(conv.id);
}
