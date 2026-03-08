import assert from 'assert/strict';
import test from 'node:test';
import { createTestFixture } from '../helpers/fixture';
import { MAX_RETRIES } from '../../src/lib/db';
import { getMessageByMessageId, getResponsesByMessageId, openQueueDb } from '../helpers/db';
import { getDeadMessages, getQueueStatus, postMessage, retryDeadMessage, waitForResponse } from '../helpers/http';
import { startProcessor } from '../helpers/processor';
import { waitFor } from '../helpers/wait';

test('queue lifecycle exposes processing state and completes successfully', async () => {
    const fixture = await createTestFixture();
    let processor;
    const db = openQueueDb(fixture.tinyclawHome);

    try {
        processor = await startProcessor(fixture, {
            TINYCLAW_FAKE_PROVIDER_DELAY_MS: '300',
        });

        const messageId = await postMessage(fixture.baseUrl, 'observe lifecycle');
        const inserted = await waitFor(() => getMessageByMessageId(db, messageId), 5_000);
        const processingStatus = await waitFor(async () => {
            const status = await getQueueStatus(fixture.baseUrl);
            return status.processing > 0 ? status : undefined;
        }, 5_000);
        const response = await waitForResponse(fixture.baseUrl, messageId);
        const finalMessage = await waitFor(() => {
            const message = getMessageByMessageId(db, messageId);
            return message?.status === 'completed' ? message : undefined;
        }, 10_000);
        const dbResponses = getResponsesByMessageId(db, messageId);

        assert.equal(inserted.message_id, messageId);
        assert.ok(processingStatus.processing > 0);
        assert.equal(finalMessage.status, 'completed');
        assert.equal(dbResponses.length, 1);
        assert.match(response.message, /FAKE_RESPONSE:observe lifecycle/);
    } finally {
        db.close();
        await processor?.stop();
        await fixture.cleanup();
    }
});

test('provider failures dead-letter the message and retry succeeds after restart', async () => {
    const fixture = await createTestFixture();
    let processor;
    const db = openQueueDb(fixture.tinyclawHome);

    try {
        processor = await startProcessor(fixture, {
            TINYCLAW_FAKE_PROVIDER_MODE: 'always-fail',
        });

        const messageId = await postMessage(fixture.baseUrl, 'force failure');
        const deadMessage = await waitFor(async () => {
            const row = getMessageByMessageId(db, messageId);
            return row?.status === 'dead' ? row : undefined;
        }, 10_000);
        const deadMessages = await getDeadMessages(fixture.baseUrl);

        assert.equal(deadMessage.retry_count, MAX_RETRIES);
        assert.match(deadMessage.last_error || '', /simulated failure/);
        assert.ok(deadMessages.some(message => message.message_id === messageId));

        const deadId = deadMessages.find(message => message.message_id === messageId)?.id;
        assert.ok(deadId, 'expected dead-letter id');

        await processor.stop();
        processor = await startProcessor(fixture);

        await retryDeadMessage(fixture.baseUrl, deadId!);
        const response = await waitForResponse(fixture.baseUrl, messageId, 10_000);
        const completedMessage = await waitFor(() => {
            const row = getMessageByMessageId(db, messageId);
            return row?.status === 'completed' ? row : undefined;
        }, 10_000);

        assert.equal(completedMessage.retry_count, 0);
        assert.match(response.message, /FAKE_RESPONSE:force failure/);
    } finally {
        db.close();
        await processor?.stop();
        await fixture.cleanup();
    }
});
