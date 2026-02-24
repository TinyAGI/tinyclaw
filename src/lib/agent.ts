import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR } from './config';

/**
 * Recursively copy directory
 */
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

/**
 * Ensure agent directory exists with template files copied from TINYCLAW_HOME.
 * Creates directory if it doesn't exist and copies .claude/, .opencode/, heartbeat.md, and AGENTS.md.
 */
export function ensureAgentDirectory(agentDir: string, provider?: string): void {
    if (fs.existsSync(agentDir)) {
        return; // Directory already exists
    }

    fs.mkdirSync(agentDir, { recursive: true });

    // Copy .claude directory (for Claude Code CLI compatibility)
    const sourceClaudeDir = path.join(SCRIPT_DIR, '.claude');
    const targetClaudeDir = path.join(agentDir, '.claude');
    if (fs.existsSync(sourceClaudeDir)) {
        copyDirSync(sourceClaudeDir, targetClaudeDir);
    }

    // Copy .opencode directory (for Opencode CLI compatibility)
    const sourceOpencodeDir = path.join(SCRIPT_DIR, '.opencode');
    const targetOpencodeDir = path.join(agentDir, '.opencode');
    if (fs.existsSync(sourceOpencodeDir)) {
        copyDirSync(sourceOpencodeDir, targetOpencodeDir);
    }

    // Copy heartbeat.md
    const sourceHeartbeat = path.join(SCRIPT_DIR, 'heartbeat.md');
    const targetHeartbeat = path.join(agentDir, 'heartbeat.md');
    if (fs.existsSync(sourceHeartbeat)) {
        fs.copyFileSync(sourceHeartbeat, targetHeartbeat);
    }

    // Copy AGENTS.md
    const sourceAgents = path.join(SCRIPT_DIR, 'AGENTS.md');
    const targetAgents = path.join(agentDir, 'AGENTS.md');
    if (fs.existsSync(sourceAgents)) {
        fs.copyFileSync(sourceAgents, targetAgents);
    }

    // Copy AGENTS.md as .claude/CLAUDE.md
    if (fs.existsSync(sourceAgents)) {
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        fs.copyFileSync(sourceAgents, path.join(agentDir, '.claude', 'CLAUDE.md'));
    }

    // Copy AGENTS.md as .opencode/AGENTS.md (Opencode format)
    if (fs.existsSync(sourceAgents)) {
        fs.mkdirSync(path.join(agentDir, '.opencode'), { recursive: true });
        fs.copyFileSync(sourceAgents, path.join(agentDir, '.opencode', 'AGENTS.md'));
    }

    // Symlink skills directory into .claude/skills
    // Prefer .agent/skills, fall back to .agents/skills
    const sourceSkills = fs.existsSync(path.join(SCRIPT_DIR, '.agent', 'skills'))
        ? path.join(SCRIPT_DIR, '.agent', 'skills')
        : path.join(SCRIPT_DIR, '.agents', 'skills');
    const targetClaudeSkills = path.join(agentDir, '.claude', 'skills');
    if (fs.existsSync(sourceSkills) && !fs.existsSync(targetClaudeSkills)) {
        fs.mkdirSync(path.join(agentDir, '.claude'), { recursive: true });
        fs.symlinkSync(sourceSkills, targetClaudeSkills);
    }

    // Symlink skills directory into .opencode/skills (Opencode format)
    const targetOpencodeSkills = path.join(agentDir, '.opencode', 'skills');
    if (fs.existsSync(sourceSkills) && !fs.existsSync(targetOpencodeSkills)) {
        fs.mkdirSync(path.join(agentDir, '.opencode'), { recursive: true });
        fs.symlinkSync(sourceSkills, targetOpencodeSkills);
    }

    // Symlink .agent/skills to .claude/skills for agent-level access
    const targetAgentDir = path.join(agentDir, '.agent');
    const targetAgentSkills = path.join(targetAgentDir, 'skills');
    if (!fs.existsSync(targetAgentSkills)) {
        fs.mkdirSync(targetAgentDir, { recursive: true });
        fs.symlinkSync(sourceSkills, targetAgentSkills);
    }

    // Create .tinyclaw directory and copy SOUL.md
    const targetTinyclaw = path.join(agentDir, '.tinyclaw');
    fs.mkdirSync(targetTinyclaw, { recursive: true });
    const sourceSoul = path.join(SCRIPT_DIR, 'SOUL.md');
    if (fs.existsSync(sourceSoul)) {
        fs.copyFileSync(sourceSoul, path.join(targetTinyclaw, 'SOUL.md'));
    }

    // Create per-agent opencode.json if provider is opencode
    if (provider === 'opencode') {
        const opencodeConfigPath = path.join(agentDir, 'opencode.json');
        if (!fs.existsSync(opencodeConfigPath)) {
            const opencodeConfig = {
                $schema: 'https://opencode.ai/config.json',
                instructions: ['AGENTS.md'],
                agent: {
                    build: {
                        mode: 'primary',
                        prompt: 'You are a helpful AI assistant. Use available skills when appropriate.',
                        tools: { skill: true }
                    }
                },
                permission: {
                    skill: { '*': 'allow' }
                }
            };
            fs.writeFileSync(opencodeConfigPath, JSON.stringify(opencodeConfig, null, 2));
        }
    }
}

/**
 * Update the AGENTS.md in an agent's directory with current teammate info.
 * Replaces content between <!-- TEAMMATES_START --> and <!-- TEAMMATES_END --> markers.
 */
export function updateAgentTeammates(agentDir: string, agentId: string, agents: Record<string, AgentConfig>, teams: Record<string, TeamConfig>): void {
    const agentsMdPath = path.join(agentDir, 'AGENTS.md');
    if (!fs.existsSync(agentsMdPath)) return;

    let content = fs.readFileSync(agentsMdPath, 'utf8');
    const startMarker = '<!-- TEAMMATES_START -->';
    const endMarker = '<!-- TEAMMATES_END -->';
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) return;

    // Find teammates from all teams this agent belongs to
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

    // Also write to .claude/CLAUDE.md
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
        // Append markers + block
        claudeContent = claudeContent.trimEnd() + '\n\n' + startMarker + block + endMarker + '\n';
    }
    fs.writeFileSync(claudeMdPath, claudeContent);
}
