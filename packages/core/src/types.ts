export interface CustomProvider {
    name: string;
    harness: 'claude' | 'codex';
    base_url: string;
    api_key: string;
    model?: string;
}

export interface AgentConfig {
    name: string;
    provider: string;
    model: string;
    working_directory: string;
    system_prompt?: string;
    prompt_file?: string;
}

export interface TeamConfig {
    name: string;
    agents: string[];
    leader_agent: string;
}

export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'done';

export interface Task {
    id: string;
    title: string;
    description: string;
    status: TaskStatus;
    assignee: string;
    assigneeType: 'agent' | 'team' | '';
    createdAt: number;
    updatedAt: number;
}

export interface ChainStep {
    agentId: string;
    response: string;
}

export interface Settings {
    workspace?: {
        path?: string;
        name?: string;
    };
    channels?: {
        enabled?: string[];
        discord?: { bot_token?: string };
        telegram?: { bot_token?: string };
        whatsapp?: {};
        defaults?: Record<string, { agentId: string }>;
    };
    models?: {
        provider?: string;
        anthropic?: {
            model?: string;
            auth_token?: string;
        };
        openai?: {
            model?: string;
            auth_token?: string;
        };
        opencode?: {
            model?: string;
        };
    };
    agents?: Record<string, AgentConfig>;
    custom_providers?: Record<string, CustomProvider>;
    teams?: Record<string, TeamConfig>;
    monitoring?: {
        heartbeat_interval?: number;
    };
}

export interface MessageData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    timestamp: number;
    messageId: string;
    agent?: string;
    files?: string[];
    conversationId?: string;
    fromAgent?: string;
}

export interface Conversation {
    id: string;
    channel: string;
    sender: string;
    originalMessage: string;
    messageId: string;
    pending: number;
    responses: ChainStep[];
    files: Set<string>;
    totalMessages: number;
    maxMessages: number;
    teamContext: { teamId: string; team: TeamConfig };
    startTime: number;
    outgoingMentions: Map<string, number>;
    pendingAgents: Set<string>;
}

export interface ResponseData {
    channel: string;
    sender: string;
    message: string;
    originalMessage: string;
    timestamp: number;
    messageId: string;
    agent?: string;
    files?: string[];
    metadata?: Record<string, unknown>;
}

export const CLAUDE_MODEL_IDS: Record<string, string> = {
    'sonnet': 'claude-sonnet-4-5',
    'opus': 'claude-opus-4-6',
    'claude-sonnet-4-5': 'claude-sonnet-4-5',
    'claude-opus-4-6': 'claude-opus-4-6'
};

export const CODEX_MODEL_IDS: Record<string, string> = {
    'gpt-5.2': 'gpt-5.2',
    'gpt-5.3-codex': 'gpt-5.3-codex',
};

export const OPENCODE_MODEL_IDS: Record<string, string> = {
    'opencode/claude-opus-4-6': 'opencode/claude-opus-4-6',
    'opencode/claude-sonnet-4-5': 'opencode/claude-sonnet-4-5',
    'opencode/gemini-3-flash': 'opencode/gemini-3-flash',
    'opencode/gemini-3-pro': 'opencode/gemini-3-pro',
    'opencode/glm-5': 'opencode/glm-5',
    'opencode/kimi-k2.5': 'opencode/kimi-k2.5',
    'opencode/kimi-k2.5-free': 'opencode/kimi-k2.5-free',
    'opencode/minimax-m2.5': 'opencode/minimax-m2.5',
    'opencode/minimax-m2.5-free': 'opencode/minimax-m2.5-free',
    'anthropic/claude-opus-4-6': 'anthropic/claude-opus-4-6',
    'anthropic/claude-sonnet-4-5': 'anthropic/claude-sonnet-4-5',
    'openai/gpt-5.2': 'openai/gpt-5.2',
    'openai/gpt-5.3-codex': 'openai/gpt-5.3-codex',
    'openai/gpt-5.3-codex-spark': 'openai/gpt-5.3-codex-spark',
    'sonnet': 'opencode/claude-sonnet-4-5',
    'opus': 'opencode/claude-opus-4-6',
};

// Queue job data types
export interface MessageJobData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    messageId: string;
    agent?: string;
    files?: string[];
    conversationId?: string;
    fromAgent?: string;
}

export interface ResponseJobData {
    channel: string;
    sender: string;
    senderId?: string;
    message: string;
    originalMessage: string;
    messageId: string;
    agent?: string;
    files?: string[];
    metadata?: Record<string, unknown>;
}
