import { AgentConfig, TeamConfig, log } from '@tinyclaw/core';

// ── Bracket-depth tag parser ────────────────────────────────────────────────

export interface BracketTag {
    id: string;
    message: string;
    start: number;
    end: number;
}

export function extractBracketTags(text: string, prefix: '@' | '#'): BracketTag[] {
    const results: BracketTag[] = [];
    let i = 0;

    while (i < text.length) {
        if (text[i] === '[' && i + 1 < text.length && text[i + 1] === prefix) {
            const tagStart = i;

            const colonIdx = text.indexOf(':', i + 2);
            if (colonIdx === -1) { i++; continue; }

            const idPortion = text.substring(i + 2, colonIdx);
            if (idPortion.includes('[') || idPortion.includes(']')) { i++; continue; }

            const id = idPortion.trim();
            if (!id) { i++; continue; }

            let depth = 1;
            let j = colonIdx + 1;
            while (j < text.length && depth > 0) {
                if (text[j] === '[') depth++;
                else if (text[j] === ']') depth--;
                j++;
            }

            if (depth === 0) {
                const message = text.substring(colonIdx + 1, j - 1).trim();
                results.push({ id, message, start: tagStart, end: j });
            }

            i = j;
        } else {
            i++;
        }
    }

    return results;
}

export function stripBracketTags(text: string, prefix: '@' | '#'): string {
    const tags = extractBracketTags(text, prefix);
    if (tags.length === 0) return text;

    let result = '';
    let lastEnd = 0;
    for (const tag of tags) {
        result += text.substring(lastEnd, tag.start);
        lastEnd = tag.end;
    }
    result += text.substring(lastEnd);
    return result.trim();
}

export function convertTagsToReadable(text: string): string {
    const tags = extractBracketTags(text, '@');
    if (tags.length === 0) return text;

    let result = '';
    let lastEnd = 0;
    for (const tag of tags) {
        result += text.substring(lastEnd, tag.start);
        result += `→ @${tag.id}: ${tag.message}`;
        lastEnd = tag.end;
    }
    result += text.substring(lastEnd);
    return result.trim();
}

export function isTeammate(
    mentionedId: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): boolean {
    const team = teams[teamId];
    if (!team) {
        log('WARN', `isTeammate check failed: Team '${teamId}' not found`);
        return false;
    }

    if (mentionedId === currentAgentId) {
        log('DEBUG', `isTeammate check failed: Self-mention (agent: ${mentionedId})`);
        return false;
    }

    if (!team.agents.includes(mentionedId)) {
        log('WARN', `isTeammate check failed: Agent '${mentionedId}' not in team '${teamId}' (members: ${team.agents.join(', ')})`);
        return false;
    }

    if (!agents[mentionedId]) {
        log('WARN', `isTeammate check failed: Agent '${mentionedId}' not found in agents config`);
        return false;
    }

    return true;
}

export function extractTeammateMentions(
    response: string,
    currentAgentId: string,
    teamId: string,
    teams: Record<string, TeamConfig>,
    agents: Record<string, AgentConfig>
): { teammateId: string; message: string }[] {
    const results: { teammateId: string; message: string }[] = [];
    const seen = new Set<string>();

    const tags = extractBracketTags(response, '@');
    const sharedContext = stripBracketTags(response, '@');

    for (const tag of tags) {
        const directMessage = tag.message;
        const fullMessage = sharedContext
            ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
            : directMessage;

        const candidateIds = tag.id.toLowerCase().split(',').map(id => id.trim()).filter(Boolean);
        for (const candidateId of candidateIds) {
            if (!seen.has(candidateId) && isTeammate(candidateId, currentAgentId, teamId, teams, agents)) {
                results.push({ teammateId: candidateId, message: fullMessage });
                seen.add(candidateId);
            }
        }
    }
    return results;
}

export function extractChatRoomMessages(
    response: string,
    currentAgentId: string,
    teams: Record<string, TeamConfig>
): { teamId: string; message: string }[] {
    const results: { teamId: string; message: string }[] = [];
    const tags = extractBracketTags(response, '#');

    for (const tag of tags) {
        const candidateId = tag.id.toLowerCase();
        if (!tag.message) continue;

        const team = teams[candidateId];
        if (team && team.agents.includes(currentAgentId)) {
            results.push({ teamId: candidateId, message: tag.message });
        }
    }

    return results;
}
