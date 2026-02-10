export type CliProvider = 'claude' | 'codex';
export type ClaudeModelAlias = 'sonnet' | 'opus';
export type CodexModelAlias = 'gpt5codex' | 'gpt5' | 'gpt5mini';

export const DEFAULT_CLI_PROVIDER: CliProvider = 'claude';
export const DEFAULT_CLAUDE_MODEL: ClaudeModelAlias = 'sonnet';
export const DEFAULT_CODEX_MODEL: CodexModelAlias = 'gpt5codex';

export const CLAUDE_MODEL_IDS: Record<ClaudeModelAlias, string> = {
    sonnet: 'claude-sonnet-4-5',
    opus: 'claude-opus-4-6',
};

export const CODEX_MODEL_IDS: Record<CodexModelAlias, string> = {
    gpt5codex: 'gpt-5.3-codex',
    gpt5: 'gpt-5.2',
    gpt5mini: 'gpt-5.1-codex-mini',
};

