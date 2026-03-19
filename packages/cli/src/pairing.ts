#!/usr/bin/env node
import * as p from '@clack/prompts';
import fs from 'fs';
import path from 'path';
import {
    TINYAGI_HOME, SCRIPT_DIR,
    loadPairingState, savePairingState, approvePairingCode,
    PairingPendingEntry, PairingApprovedEntry,
} from '@tinyagi/core';

function getPairingFilePath(): string {
    const localSettings = path.join(SCRIPT_DIR, '.tinyagi', 'settings.json');
    if (fs.existsSync(localSettings)) {
        return path.join(SCRIPT_DIR, '.tinyagi', 'pairing.json');
    }
    return path.join(TINYAGI_HOME, 'pairing.json');
}

function ensurePairingFile(): string {
    const pairingFile = getPairingFilePath();
    const dir = path.dirname(pairingFile);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(pairingFile)) {
        fs.writeFileSync(pairingFile, JSON.stringify({ pending: [], approved: [] }, null, 2));
    }
    return pairingFile;
}

function formatDate(ts: number): string {
    return new Date(ts).toISOString();
}

function printPending(pairingFile: string) {
    const state = loadPairingState(pairingFile);
    if (state.pending.length === 0) {
        p.log.message('No pending pairing requests.');
        return;
    }

    p.log.info(`Pending (${state.pending.length}):`);
    for (const entry of state.pending) {
        p.log.message(`  ${entry.code} | ${entry.channel} | ${entry.sender} (${entry.senderId}) | requested ${formatDate(entry.createdAt)}`);
    }
}

function printApproved(pairingFile: string) {
    const state = loadPairingState(pairingFile);
    if (state.approved.length === 0) {
        p.log.message('No approved senders.');
        return;
    }

    p.log.info(`Approved (${state.approved.length}):`);
    for (const entry of state.approved) {
        const via = entry.approvedCode ? ` | via ${entry.approvedCode}` : '';
        p.log.message(`  ${entry.channel} | ${entry.sender} (${entry.senderId}) | approved ${formatDate(entry.approvedAt)}${via}`);
    }
}

function approveCode(pairingFile: string, code: string) {
    const result = approvePairingCode(pairingFile, code);
    if (!result.ok) {
        p.log.error(result.reason || 'Failed to approve pairing code.');
        process.exit(1);
    }

    const entry = result.entry!;
    p.log.success(`Approved ${entry.sender} (${entry.channel}:${entry.senderId})`);
}

function unpairSender(pairingFile: string, channel: string, senderId: string) {
    const state = loadPairingState(pairingFile);
    const idx = state.approved.findIndex(
        e => e.channel === channel && e.senderId === senderId
    );

    if (idx === -1) {
        p.log.error(`Approved sender not found: ${channel}:${senderId}`);
        process.exit(1);
    }

    state.approved.splice(idx, 1);
    savePairingState(pairingFile, state);
    p.log.success(`Unpaired ${channel}:${senderId}`);
}

// --- CLI dispatch ---

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

const pairingFile = ensurePairingFile();

switch (command) {
    case 'pending':
        printPending(pairingFile);
        break;
    case 'approved':
        printApproved(pairingFile);
        break;
    case 'list':
    case 'ls':
        printPending(pairingFile);
        console.log('');
        printApproved(pairingFile);
        break;
    case 'approve':
        if (!arg1) {
            p.log.error('Usage: pairing approve <code>');
            process.exit(1);
        }
        approveCode(pairingFile, arg1);
        break;
    case 'unpair':
        if (!arg1 || !arg2) {
            p.log.error('Usage: pairing unpair <channel> <sender_id>');
            process.exit(1);
        }
        unpairSender(pairingFile, arg1, arg2);
        break;
    default:
        p.log.error('Usage: pairing {pending|approved|list|approve <code>|unpair <channel> <sender_id>}');
        process.exit(1);
}
