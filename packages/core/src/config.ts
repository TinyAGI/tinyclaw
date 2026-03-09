import fs from 'fs';
import path from 'path';
import { jsonrepair } from 'jsonrepair';
import { Settings, AgentConfig, TeamConfig, CLAUDE_MODEL_IDS, CODEX_MODEL_IDS, OPENCODE_MODEL_IDS } from './types';

export const SCRIPT_DIR = path.resolve(__dirname, '../../..');
const _localTinyclaw = path.join(SCRIPT_DIR, '.tinyclaw');
export const TINYCLAW_HOME = process.env.TINYCLAW_HOME
    || (fs.existsSync(path.join(_localTinyclaw, 'settings.json'))
        ? _localTinyclaw
        : path.join(require('os').homedir(), '.tinyclaw'));
export const LOG_FILE = path.join(TINYCLAW_HOME, 'logs/queue.log');
export const SETTINGS_FILE = path.join(TINYCLAW_HOME, 'settings.json');
export const CHATS_DIR = path.join(TINYCLAW_HOME, 'chats');
export const FILES_DIR = path.join(TINYCLAW_HOME, 'files');

export function getSettings(): Settings {
    try {
        const settingsData = fs.readFileSync(SETTINGS_FILE, 'utf8');
        let settings: Settings;

        try {
            settings = JSON.parse(settingsData);
        } catch (parseError) {
            console.error(`[WARN] settings.json contains invalid JSON: ${(parseError as Error).message}`);

            try {
                const repaired = jsonrepair(settingsData);
                settings = JSON.parse(repaired);

                const backupPath = SETTINGS_FILE + '.bak';
                fs.copyFileSync(SETTINGS_FILE, backupPath);
                fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
                console.error(`[WARN] Auto-fixed settings.json (backup: ${backupPath})`);
            } catch {
                console.error(`[ERROR] Could not auto-fix settings.json — returning empty config`);
                return {};
            }
        }

        if (!settings?.models?.provider) {
            if (settings?.models?.openai) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'openai';
            } else if (settings?.models?.opencode) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'opencode';
            } else if (settings?.models?.anthropic) {
                if (!settings.models) settings.models = {};
                settings.models.provider = 'anthropic';
            }
        }

        return settings;
    } catch {
        return {};
    }
}

export function getDefaultAgentFromModels(settings: Settings): AgentConfig {
    const provider = settings?.models?.provider || 'anthropic';
    let model = '';
    if (provider === 'openai') {
        model = settings?.models?.openai?.model || 'gpt-5.3-codex';
    } else if (provider === 'opencode') {
        model = settings?.models?.opencode?.model || 'sonnet';
    } else {
        model = settings?.models?.anthropic?.model || 'sonnet';
    }

    const workspacePath = settings?.workspace?.path || path.join(require('os').homedir(), 'tinyclaw-workspace');
    const defaultAgentDir = path.join(workspacePath, 'default');

    return {
        name: 'Default',
        provider,
        model,
        working_directory: defaultAgentDir,
    };
}

export function getAgents(settings: Settings): Record<string, AgentConfig> {
    if (settings.agents && Object.keys(settings.agents).length > 0) {
        return settings.agents;
    }
    return { default: getDefaultAgentFromModels(settings) };
}

export function getTeams(settings: Settings): Record<string, TeamConfig> {
    return settings.teams || {};
}

export function resolveClaudeModel(model: string): string {
    return CLAUDE_MODEL_IDS[model] || model || '';
}

export function resolveCodexModel(model: string): string {
    return CODEX_MODEL_IDS[model] || model || '';
}

export function resolveOpenCodeModel(model: string): string {
    return OPENCODE_MODEL_IDS[model] || model || '';
}
