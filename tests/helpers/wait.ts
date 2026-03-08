export async function waitFor<T>(
    check: () => Promise<T | undefined> | T | undefined,
    timeoutMs = 10_000,
    intervalMs = 50
): Promise<T> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        const result = await check();
        if (result !== undefined && result !== null) {
            return result;
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Timed out after ${timeoutMs}ms`);
}
