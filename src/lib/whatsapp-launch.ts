export function buildWhatsAppChromiumArgs(disableSandbox: boolean): string[] {
    const baseArgs = [
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
    ];

    if (!disableSandbox) {
        return baseArgs;
    }

    return ['--no-sandbox', '--disable-setuid-sandbox', ...baseArgs];
}
