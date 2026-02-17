import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { log } from './logging';

export interface TranscriptionConfig {
    enabled?: boolean;
    base_url?: string;
    api_key?: string;
    model?: string;
    retain_audio?: boolean;
}

const AUDIO_EXTENSIONS = new Set(['.ogg', '.mp3', '.wav', '.m4a', '.flac', '.opus', '.oga', '.webm']);

export function isAudioFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return AUDIO_EXTENSIONS.has(ext);
}

export function extractAudioFiles(message: string): string[] {
    const fileRegex = /\[file:\s*([^\]]+)\]/g;
    const audioFiles: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = fileRegex.exec(message)) !== null) {
        const filePath = match[1].trim();
        if (isAudioFile(filePath)) {
            audioFiles.push(filePath);
        }
    }
    return audioFiles;
}

export async function transcribeAudio(filePath: string, config: TranscriptionConfig): Promise<string> {
    const baseUrl = config.base_url || 'https://api.mistral.ai/v1';
    const apiKey = config.api_key || process.env.TRANSCRIPTION_API_KEY;
    const model = config.model || 'voxtral-mini-latest';

    if (!apiKey) {
        throw new Error('Transcription API key not configured (set transcription.api_key or TRANSCRIPTION_API_KEY env)');
    }

    const url = new URL(`${baseUrl}/audio/transcriptions`);
    const fileData = fs.readFileSync(filePath);
    const filename = path.basename(filePath);

    // Build multipart form data
    const boundary = `----TinyClawBoundary${Date.now()}${Math.random().toString(36).slice(2)}`;
    const parts: Buffer[] = [];

    // File field
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    ));
    parts.push(fileData);
    parts.push(Buffer.from('\r\n'));

    // Model field
    parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="model"\r\n\r\n` +
        `${model}\r\n`
    ));

    // Closing boundary
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(parts);

    return new Promise((resolve, reject) => {
        const options: https.RequestOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
            },
        };

        const requester = url.protocol === 'https:' ? https : http;
        const req = requester.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => {
                const responseBody = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(responseBody);
                        resolve(parsed.text || '');
                    } catch {
                        reject(new Error(`Failed to parse transcription response: ${responseBody.substring(0, 200)}`));
                    }
                } else {
                    reject(new Error(`Transcription API error (${res.statusCode}): ${responseBody.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

export async function processAudioInMessage(message: string, config: TranscriptionConfig): Promise<string> {
    const audioFiles = extractAudioFiles(message);
    if (audioFiles.length === 0) return message;

    let result = message;

    for (const filePath of audioFiles) {
        if (!fs.existsSync(filePath)) {
            log('WARN', `Audio file not found for transcription: ${filePath}`);
            continue;
        }

        try {
            log('INFO', `Transcribing audio: ${path.basename(filePath)}`);
            const transcription = await transcribeAudio(filePath, config);
            log('INFO', `Transcription complete: ${transcription.substring(0, 80)}...`);

            const escaped = transcription.replace(/"/g, '\\"');
            const replacement = `[voice transcription: "${escaped}"]`;
            result = result.replace(`[file: ${filePath}]`, replacement);

            // Delete audio file unless retain_audio is set
            if (!config.retain_audio) {
                try {
                    fs.unlinkSync(filePath);
                    log('INFO', `Deleted audio file: ${path.basename(filePath)}`);
                } catch (e) {
                    log('WARN', `Failed to delete audio file: ${(e as Error).message}`);
                }
            }
        } catch (error) {
            log('ERROR', `Transcription failed for ${path.basename(filePath)}: ${(error as Error).message}`);
            // Leave the original [file: ...] reference intact on failure
        }
    }

    return result;
}
