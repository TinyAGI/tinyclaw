export function messageSizeSummary(text: string): string {
    const length = (text || '').length;
    if (length === 0) {
        return 'empty message';
    }
    if (length === 1) {
        return '1 character';
    }
    return `${length} characters`;
}
