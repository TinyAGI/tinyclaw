import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR } from './config';

export function copyDirSync(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirSync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

export function ensureAgentDirectory(agentDir: string): void {
    if (fs.existsSync(agentDir)) {
        return;
    }

    fs.mkdirSync(agentDir, { recursive: true });

    const sourceClaudeDir = path.join(SCRIPT_DIR, '.claude');
    const targetClaudeDir = path.join(agentDir, '.claude');
    if (fs.existsSync(sourceClaudeDir)) {
        copyDirSync(sourceClaudeDir, targetClaudeDir);
    }

    const sourceHeartbeat = path.join(SCRIPT_DIR, 'heartbeat.md');
    const targetHeartbeat = path.join(agentDir, 'heartbeat.md');
    if (fs.existsSync(sourceHeartbeat)) {
        fs.copyFileSync(sourceHeartbeat, targetHeartbeat);
    }

    const sourceAgents = path.join(SCRIPT_DIR, 'AGENTS.md');
    const targetAgents = path.join(agentDir, 'AGENTS.md');
    if (fs.existsSync(sourceAgents)) {
        fs.copyFileSync(sourceAgents, targetAgents);
    }

    if (fs.existsSync(sourceAgents)) {
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        fs.copyFileSync(sourceAgents, path.join(agentDir, '.claude', 'CLAUDE.md'));
    }

    const sourceSkills = path.join(SCRIPT_DIR, '.agents', 'skills');
    if (fs.existsSync(sourceSkills)) {
        const targetAgentsSkills = path.join(agentDir, '.agents', 'skills');
        fs.mkdirSync(targetAgentsSkills, { recursive: true });
        copyDirSync(sourceSkills, targetAgentsSkills);

        const targetClaudeSkills = path.join(agentDir, '.claude', 'skills');
        fs.mkdirSync(targetClaudeSkills, { recursive: true });
        copyDirSync(targetAgentsSkills, targetClaudeSkills);
    }

    const targetTinyclaw = path.join(agentDir, '.tinyclaw');
    fs.mkdirSync(targetTinyclaw, { recursive: true });
    const sourceSoul = path.join(SCRIPT_DIR, 'SOUL.md');
    if (fs.existsSync(sourceSoul)) {
        fs.copyFileSync(sourceSoul, path.join(targetTinyclaw, 'SOUL.md'));
    }
}

export function updateAgentTeammates(agentDir: string, agentId: string, agents: Record<string, AgentConfig>, teams: Record<string, TeamConfig>): void {
    const agentsMdPath = path.join(agentDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) return;

    let content = fs.readFileSync(agentsMdPath, 'utf8');
    const startMarker = '<!-- TEAMMATES_START -->';
    const endMarker = '<!-- TEAMMATES_END -->';
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) return;

    const teammates: { id: string; name: string; model: string }[] = [];
    for (const team of Object.values(teams)) {
        if (!team.agents.includes(agentId)) continue;
        for (const tid of team.agents) {
            if (tid === agentId) continue;
            const agent = agents[tid];
            if (agent && !teammates.some(t => t.id === tid)) {
                teammates.push({ id: tid, name: agent.name, model: agent.model });
            }
        }
    }

    let block = '';
    const self = agents[agentId];
    if (self) {
        block += `\n### You\n\n- \`@${agentId}\` — **${self.name}** (${self.model})\n`;
    }
    if (teammates.length > 0) {
        block += '\n### Your Teammates\n\n';
        for (const t of teammates) {
            block += `- \`@${t.id}\` — **${t.name}** (${t.model})\n`;
        }
    }

    const newContent = content.substring(0, startIdx + startMarker.length) + block + content.substring(endIdx);
    fs.writeFileSync(agentsMdPath, newContent);

    const claudeDir = path.join(agentDir, '.claude');
    if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
    }
    const claudeMdPath = path.join(claudeDir, 'CLAUDE.md');
    let claudeContent = '';
    if (fs.existsSync(claudeMdPath)) {
        claudeContent = fs.readFileSync(claudeMdPath, 'utf8');
    }
    const cStartIdx = claudeContent.indexOf(startMarker);
    const cEndIdx = claudeContent.indexOf(endMarker);
    if (cStartIdx !== -1 && cEndIdx !== -1) {
        claudeContent = claudeContent.substring(0, cStartIdx + startMarker.length) + block + claudeContent.substring(cEndIdx);
    } else {
        claudeContent = claudeContent.trimEnd() + '\n\n' + startMarker + block + endMarker + '\n';
    }
    fs.writeFileSync(claudeMdPath, claudeContent);
}
