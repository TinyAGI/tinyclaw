import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, CustomProvider, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel, resolveOpenCodeModel, getSettings } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent';

export async function runCommand(command: string, args: string[], cwd?: string, envOverrides?: Record<string, string>): Promise<string> {
    return new Promise((resolve, reject) => {
        const env = { ...process.env, ...envOverrides };
        delete env.CLAUDECODE;

        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
            env,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
        });

        child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
        });

        child.on('error', (error) => {
            reject(error);
        });

        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
                return;
            }

            const errorMessage = stderr.trim() || `Command exited with code ${code}`;
            reject(new Error(errorMessage));
        });
    });
}

export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {}
): Promise<string> {
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    updateAgentTeammates(agentDir, agentId, agents, teams);

    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const rawProvider = agent.provider || 'anthropic';

    let provider = rawProvider;
    let customProvider: CustomProvider | undefined;
    let envOverrides: Record<string, string> = {};

    if (rawProvider.startsWith('custom:')) {
        const customId = rawProvider.slice('custom:'.length);
        const settings = getSettings();
        customProvider = settings.custom_providers?.[customId];
        if (!customProvider) {
            throw new Error(`Custom provider '${customId}' not found in settings.custom_providers`);
        }
        provider = customProvider.harness === 'codex' ? 'openai' : 'anthropic';

        if (customProvider.harness === 'claude') {
            envOverrides = {
                ANTHROPIC_BASE_URL: customProvider.base_url,
                ANTHROPIC_AUTH_TOKEN: customProvider.api_key,
                ANTHROPIC_API_KEY: '',
            };
        } else if (customProvider.harness === 'codex') {
            envOverrides = {
                OPENAI_API_KEY: customProvider.api_key,
                OPENAI_BASE_URL: customProvider.base_url,
            };
        }

        log('INFO', `Using custom provider '${customId}' (harness: ${customProvider.harness}, base_url: ${customProvider.base_url})`);
    } else {
        const settings = getSettings();
        if (provider === 'anthropic' && settings.models?.anthropic?.auth_token) {
            envOverrides.ANTHROPIC_API_KEY = settings.models.anthropic.auth_token;
        } else if (provider === 'openai' && settings.models?.openai?.auth_token) {
            envOverrides.OPENAI_API_KEY = settings.models.openai.auth_token;
        }
    }

    const effectiveModel = agent.model || customProvider?.model || '';

    if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        const shouldResume = !shouldReset;

        if (shouldReset) {
            log('INFO', `Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = customProvider ? effectiveModel : resolveCodexModel(effectiveModel);
        const codexArgs = ['exec'];
        if (shouldResume) {
            codexArgs.push('resume', '--last');
        }
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        const codexOutput = await runCommand('codex', codexArgs, workingDir, envOverrides);

        let response = '';
        const lines = codexOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'item.completed' && json.item?.type === 'agent_message') {
                    response = json.item.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from Codex.';
    } else if (provider === 'opencode') {
        const modelId = resolveOpenCodeModel(effectiveModel);
        log('INFO', `Using OpenCode CLI (agent: ${agentId}, model: ${modelId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `Resetting OpenCode conversation for agent: ${agentId}`);
        }

        const opencodeArgs = ['run', '--format', 'json'];
        if (modelId) {
            opencodeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            opencodeArgs.push('-c');
        }
        opencodeArgs.push(message);

        const opencodeOutput = await runCommand('opencode', opencodeArgs, workingDir, envOverrides);

        let response = '';
        const lines = opencodeOutput.trim().split('\n');
        for (const line of lines) {
            try {
                const json = JSON.parse(line);
                if (json.type === 'text' && json.part?.text) {
                    response = json.part.text;
                }
            } catch (e) {
                // Ignore lines that aren't valid JSON
            }
        }

        return response || 'Sorry, I could not generate a response from OpenCode.';
    } else {
        log('INFO', `Using Claude provider (agent: ${agentId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `Resetting conversation for agent: ${agentId}`);
        }

        const modelId = customProvider ? effectiveModel : resolveClaudeModel(effectiveModel);
        const claudeArgs = ['--dangerously-skip-permissions'];
        if (modelId) {
            claudeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            claudeArgs.push('-c');
        }
        claudeArgs.push('-p', message);

        return await runCommand('claude', claudeArgs, workingDir, envOverrides);
    }
}
