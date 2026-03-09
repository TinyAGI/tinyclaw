import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { log } from './logging';

/**
 * Parse @agent_id or @team_id prefix from a message.
 * Returns { agentId, message, isTeam } where message has the prefix stripped.
 */
export function parseAgentRouting(
    rawMessage: string,
    agents: Record<string, AgentConfig>,
    teams: Record<string, TeamConfig> = {}
): { agentId: string; message: string; isTeam?: boolean } {
    const match = rawMessage.match(/^@(\S+)\s+([\s\S]*)$/);
    if (match) {
        const candidateId = match[1].toLowerCase();
        const message = match[2];

        if (agents[candidateId]) {
            return { agentId: candidateId, message };
        }

        if (teams[candidateId]) {
            return { agentId: teams[candidateId].leader_agent, message, isTeam: true };
        }

        for (const [id, config] of Object.entries(agents)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: id, message };
            }
        }

        for (const [, config] of Object.entries(teams)) {
            if (config.name.toLowerCase() === candidateId) {
                return { agentId: config.leader_agent, message, isTeam: true };
            }
        }
    }
    return { agentId: 'default', message: rawMessage };
}

/**
 * Find the first team that contains the given agent.
 */
export function findTeamForAgent(agentId: string, teams: Record<string, TeamConfig>): { teamId: string; team: TeamConfig } | null {
    for (const [teamId, team] of Object.entries(teams)) {
        if (team.agents.includes(agentId)) {
            return { teamId, team };
        }
    }
    return null;
}

/**
 * Get the reset flag path for a specific agent.
 */
export function getAgentResetFlag(agentId: string, workspacePath: string): string {
    return path.join(workspacePath, agentId, 'reset_flag');
}
