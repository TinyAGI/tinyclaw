import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { AgentConfig, TeamConfig } from './types';
import { SCRIPT_DIR, resolveClaudeModel, resolveCodexModel } from './config';
import { log } from './logging';
import { ensureAgentDirectory, updateAgentTeammates } from './agent-setup';

export interface RunCommandOptions {
    onStdoutChunk?: (chunk: string) => void;
}

export async function runCommand(
    command: string,
    args: string[],
    cwd?: string,
    options?: RunCommandOptions,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: cwd || SCRIPT_DIR,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');

        child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            if (options?.onStdoutChunk) {
                try {
                    options.onStdoutChunk(chunk);
                } catch {
                    // Never let streaming callbacks break command execution.
                }
            }
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

/**
 * Invoke a single agent with a message. Contains all Claude/Codex invocation logic.
 * Returns the raw response text.
 */
export async function invokeAgent(
    agent: AgentConfig,
    agentId: string,
    message: string,
    workspacePath: string,
    shouldReset: boolean,
    agents: Record<string, AgentConfig> = {},
    teams: Record<string, TeamConfig> = {},
    onPartialResponse?: (text: string) => void
): Promise<string> {
    // Ensure agent directory exists with config files
    const agentDir = path.join(workspacePath, agentId);
    const isNewAgent = !fs.existsSync(agentDir);
    ensureAgentDirectory(agentDir);
    if (isNewAgent) {
        log('INFO', `Initialized agent directory with config files: ${agentDir}`);
    }

    // Update AGENTS.md with current teammate info
    updateAgentTeammates(agentDir, agentId, agents, teams);

    // Resolve working directory
    const workingDir = agent.working_directory
        ? (path.isAbsolute(agent.working_directory)
            ? agent.working_directory
            : path.join(workspacePath, agent.working_directory))
        : agentDir;

    const provider = agent.provider || 'anthropic';

    if (provider === 'openai') {
        log('INFO', `Using Codex CLI (agent: ${agentId})`);

        const shouldResume = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting Codex conversation for agent: ${agentId}`);
        }

        const modelId = resolveCodexModel(agent.model);
        const codexArgs = ['exec'];
        if (shouldResume) {
            codexArgs.push('resume', '--last');
        }
        if (modelId) {
            codexArgs.push('--model', modelId);
        }
        codexArgs.push('--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '--json', message);

        const codexOutput = await runCommand('codex', codexArgs, workingDir);

        // Parse JSONL output and extract final agent_message
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
    } else {
        // Default to Claude (Anthropic)
        log('INFO', `Using Claude provider (agent: ${agentId})`);

        const continueConversation = !shouldReset;

        if (shouldReset) {
            log('INFO', `🔄 Resetting conversation for agent: ${agentId}`);
        }

        const modelId = resolveClaudeModel(agent.model);
        const claudeArgs = ['--dangerously-skip-permissions'];
        if (modelId) {
            claudeArgs.push('--model', modelId);
        }
        if (continueConversation) {
            claudeArgs.push('-c');
        }

        // Stream JSON is required for token-level partial updates.
        const useStreamJson = typeof onPartialResponse === 'function';
        if (useStreamJson) {
            claudeArgs.push(
                '--output-format', 'stream-json',
                '--verbose',
                '--include-partial-messages',
            );
        }

        claudeArgs.push('-p', message);

        if (!useStreamJson) {
            return await runCommand('claude', claudeArgs, workingDir);
        }

        let streamBuffer = '';
        let partialText = '';
        let finalTextFromStream = '';

        const processStreamLine = (line: string): void => {
            const trimmed = line.trim();
            if (!trimmed || trimmed[0] !== '{') {
                return;
            }

            try {
                const json = JSON.parse(trimmed);

                if (json?.type === 'stream_event') {
                    const event = json.event;
                    if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
                        const delta = event.delta.text;
                        if (typeof delta === 'string' && delta.length > 0) {
                            partialText += delta;
                            onPartialResponse?.(partialText);
                        }
                    }
                    return;
                }

                if (json?.type === 'assistant' && Array.isArray(json?.message?.content)) {
                    const content = json.message.content
                        .filter((c: any) => c?.type === 'text' && typeof c?.text === 'string')
                        .map((c: any) => c.text)
                        .join('');
                    if (content) {
                        finalTextFromStream = content;
                    }
                    return;
                }

                if (json?.type === 'result' && typeof json?.result === 'string') {
                    finalTextFromStream = json.result;
                }
            } catch {
                // Ignore non-JSON/non-stream lines.
            }
        };

        const rawOutput = await runCommand(
            'claude',
            claudeArgs,
            workingDir,
            {
                onStdoutChunk: (chunk: string) => {
                    streamBuffer += chunk;
                    let newlineIndex = streamBuffer.indexOf('\n');
                    while (newlineIndex !== -1) {
                        const line = streamBuffer.slice(0, newlineIndex);
                        streamBuffer = streamBuffer.slice(newlineIndex + 1);
                        processStreamLine(line);
                        newlineIndex = streamBuffer.indexOf('\n');
                    }
                },
            },
        );

        if (streamBuffer.trim().length > 0) {
            processStreamLine(streamBuffer);
        }

        return (finalTextFromStream || partialText || rawOutput).trim();
    }
}
