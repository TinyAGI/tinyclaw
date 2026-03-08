import { ChildProcess, spawn } from 'child_process';
import { getQueueStatus } from './http';
import { REPO_ROOT } from './paths';
import { getFreePort, TestFixture } from './fixture';
import { waitFor } from './wait';

export interface ProcessorHandle {
    child: ChildProcess;
    stop(): Promise<void>;
    output(): string;
}

export async function startProcessor(
    fixture: TestFixture,
    env: Record<string, string> = {}
): Promise<ProcessorHandle> {
    for (let attempt = 0; attempt < 5; attempt++) {
        let outputBuffer = '';
        let exited = false;

        const child = spawn(process.execPath, ['dist/queue-processor.js'], {
            cwd: REPO_ROOT,
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HOME: fixture.homeDir,
                TINYCLAW_HOME: fixture.tinyclawHome,
                TINYCLAW_API_PORT: String(fixture.apiPort),
                ...env,
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout?.setEncoding('utf8');
        child.stderr?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            outputBuffer += chunk;
        });
        child.stderr?.on('data', (chunk: string) => {
            outputBuffer += chunk;
        });
        child.on('exit', () => {
            exited = true;
        });

        try {
            await waitFor(async () => {
                if (exited) {
                    throw new Error(`Queue processor exited before readiness:\n${outputBuffer}`);
                }
                try {
                    return await getQueueStatus(fixture.baseUrl);
                } catch {
                    return undefined;
                }
            }, 10_000);

            return {
                child,
                async stop() {
                    if (exited) {
                        return;
                    }

                    const exitPromise = new Promise<void>((resolve) => {
                        child.once('exit', () => resolve());
                    });
                    let timeoutId: NodeJS.Timeout | undefined;

                    child.kill('SIGTERM');
                    await Promise.race([
                        exitPromise,
                        new Promise<void>((resolve, reject) => {
                            timeoutId = setTimeout(() => {
                                if (!exited) {
                                    child.kill('SIGKILL');
                                }
                                reject(new Error(`Timed out stopping queue processor:\n${outputBuffer}`));
                            }, 5_000);
                        }),
                    ]).catch(async (error) => {
                        await exitPromise;
                        throw error;
                    }).finally(() => {
                        if (timeoutId) {
                            clearTimeout(timeoutId);
                        }
                    });
                },
                output() {
                    return outputBuffer;
                },
            };
        } catch (error) {
            if (!outputBuffer.includes('EADDRINUSE') || attempt === 4) {
                throw error;
            }

            fixture.apiPort = await getFreePort();
            fixture.baseUrl = `http://127.0.0.1:${fixture.apiPort}`;
            await new Promise(resolve => child.once('exit', resolve));
        }
    }

    throw new Error('Queue processor could not start after retrying port allocation');
}
