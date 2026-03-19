import { customAlphabet } from 'nanoid';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 8);

export function genId(prefix: string): string {
    return `${prefix}_${nano()}`;
}
