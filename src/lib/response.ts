import fs from 'fs';
import path from 'path';
import { FILES_DIR } from './config';
import { createLogger } from './logging';

export const LONG_RESPONSE_THRESHOLD = 4000;
const logger = createLogger({ runtime: 'queue', source: 'queue', component: 'response' });

/**
 * If a response exceeds the threshold, save full text as a .md file
 * and return a truncated preview with the file attached.
 */
export function handleLongResponse(
    response: string,
    existingFiles: string[]
): { message: string; files: string[] } {
    if (response.length <= LONG_RESPONSE_THRESHOLD) {
        return { message: response, files: existingFiles };
    }

    // Save full response as a .md file
    const filename = `response_${Date.now()}.md`;
    const filePath = path.join(FILES_DIR, filename);
    fs.writeFileSync(filePath, response);
    logger.info({ context: { filename, responseLength: response.length } }, 'Long response saved to file');

    // Truncate to preview
    const preview = response.substring(0, LONG_RESPONSE_THRESHOLD) + '\n\n_(Full response attached as file)_';

    return { message: preview, files: [...existingFiles, filePath] };
}

/**
 * Collect files from a response text.
 */
export function collectFiles(response: string, fileSet: Set<string>): void {
    const fileRegex = /\[send_file:\s*([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = fileRegex.exec(response)) !== null) {
        const filePath = match[1].trim();
        if (fs.existsSync(filePath)) fileSet.add(filePath);
    }
}
