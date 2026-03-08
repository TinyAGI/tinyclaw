import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import net from 'net';
import { AgentConfig, Settings, TeamConfig } from '../../src/lib/types';

export interface TestFixture {
    rootDir: string;
    homeDir: string;
    tinyclawHome: string;
    workspacePath: string;
    settingsPath: string;
    apiPort: number;
    baseUrl: string;
    cleanup(): Promise<void>;
}

interface CreateFixtureOptions {
    agents?: Record<string, Partial<AgentConfig>>;
    teams?: Record<string, TeamConfig>;
}

export async function getFreePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = net.createServer();
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                if (!address || typeof address === 'string') {
                    reject(new Error('Could not resolve a free port'));
                    return;
                }
                resolve(address.port);
            });
        });
        server.on('error', reject);
    });
}

function buildAgents(
    workspacePath: string,
    overrides: Record<string, Partial<AgentConfig>> | undefined
): Record<string, AgentConfig> {
    const source = overrides && Object.keys(overrides).length > 0
        ? overrides
        : {
            default: {
                name: 'Default',
            },
        };

    return Object.fromEntries(
        Object.entries(source).map(([agentId, config]) => [
            agentId,
            {
                name: config.name || agentId,
                provider: config.provider || 'fake',
                model: config.model || 'fake',
                working_directory: config.working_directory || path.join(workspacePath, agentId),
                system_prompt: config.system_prompt,
                prompt_file: config.prompt_file,
            },
        ])
    );
}

export async function createTestFixture(options: CreateFixtureOptions = {}): Promise<TestFixture> {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tinyclaw-test-'));
    const homeDir = path.join(rootDir, 'home');
    const tinyclawHome = path.join(homeDir, '.tinyclaw');
    const workspacePath = path.join(rootDir, 'workspace');
    const settingsPath = path.join(tinyclawHome, 'settings.json');
    const apiPort = await getFreePort();

    await fs.mkdir(tinyclawHome, { recursive: true });
    await fs.mkdir(workspacePath, { recursive: true });

    const settings: Settings = {
        workspace: {
            path: workspacePath,
        },
        agents: buildAgents(workspacePath, options.agents),
        teams: options.teams || {},
    };

    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');

    return {
        rootDir,
        homeDir,
        tinyclawHome,
        workspacePath,
        settingsPath,
        apiPort,
        baseUrl: `http://127.0.0.1:${apiPort}`,
        async cleanup() {
            await fs.rm(rootDir, { recursive: true, force: true });
        },
    };
}
