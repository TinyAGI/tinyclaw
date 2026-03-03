import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsAppChromiumArgs } from '../lib/whatsapp-launch';

test('buildWhatsAppChromiumArgs keeps sandbox enabled by default', () => {
    const args = buildWhatsAppChromiumArgs(false);
    assert.equal(args.includes('--no-sandbox'), false);
    assert.equal(args.includes('--disable-setuid-sandbox'), false);
    assert.equal(args.includes('--disable-dev-shm-usage'), true);
});

test('buildWhatsAppChromiumArgs can disable sandbox explicitly', () => {
    const args = buildWhatsAppChromiumArgs(true);
    assert.equal(args[0], '--no-sandbox');
    assert.equal(args[1], '--disable-setuid-sandbox');
});
