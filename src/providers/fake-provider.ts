function getDelayMs(): number {
    const raw = process.env.TINYCLAW_FAKE_PROVIDER_DELAY_MS;
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getMode(): 'success' | 'always-fail' {
    return process.env.TINYCLAW_FAKE_PROVIDER_MODE === 'always-fail'
        ? 'always-fail'
        : 'success';
}

function getFailOnSubstring(): string | null {
    const value = process.env.TINYCLAW_FAKE_PROVIDER_FAIL_ON;
    return value && value.length > 0 ? value : null;
}

export async function fakeProvider(prompt: string): Promise<string> {
    const delayMs = getDelayMs();
    if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    const failOnSubstring = getFailOnSubstring();
    if (getMode() === 'always-fail' || (failOnSubstring && prompt.includes(failOnSubstring))) {
        throw new Error('simulated failure');
    }

    return `FAKE_RESPONSE:${prompt}`;
}
