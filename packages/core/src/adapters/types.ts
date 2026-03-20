/**
 * Adapter interface — each CLI backend implements this to handle agent invocation.
 */
export interface InvokeOptions {
    agentId: string;
    message: string;
    workingDir: string;
    systemPrompt: string;
    model: string;
    shouldReset: boolean;
    envOverrides: Record<string, string>;
    onEvent?: (text: string) => void;
}

export interface AgentAdapter {
    /** Unique provider key(s) this adapter handles (e.g. 'anthropic', 'openai'). */
    providers: string[];
    /** Execute the agent and return the response text. */
    invoke(options: InvokeOptions): Promise<string>;
}
