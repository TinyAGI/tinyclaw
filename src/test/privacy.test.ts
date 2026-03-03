import test from 'node:test';
import assert from 'node:assert/strict';
import { messageSizeSummary } from '../lib/privacy';

test('messageSizeSummary reports empty message', () => {
    assert.equal(messageSizeSummary(''), 'empty message');
});

test('messageSizeSummary reports singular/plural sizes', () => {
    assert.equal(messageSizeSummary('a'), '1 character');
    assert.equal(messageSizeSummary('abcd'), '4 characters');
});
