import assert from 'assert/strict';
import test from 'node:test';
import { createTestFixture } from '../helpers/fixture';
import { getDeadMessages, postMessage, waitForResponse } from '../helpers/http';
import { startProcessor } from '../helpers/processor';
import { waitFor } from '../helpers/wait';

test('team conversations still complete when an internal branch dies', async () => {
    const fixture = await createTestFixture({
        agents: {
            default: { name: 'Default' },
            leader: { name: 'Leader' },
            reviewer: { name: 'Reviewer' },
        },
        teams: {
            dev: {
                name: 'Dev Team',
                leader_agent: 'leader',
                agents: ['leader', 'reviewer'],
            },
        },
    });
    let processor;

    try {
        processor = await startProcessor(fixture, {
            TINYCLAW_FAKE_PROVIDER_FAIL_ON: 'Directed to you:',
        });

        const messageId = await postMessage(
            fixture.baseUrl,
            '@dev start review [@reviewer: inspect this branch]'
        );

        const response = await waitForResponse(fixture.baseUrl, messageId, 10_000);
        const deadMessages = await waitFor(async () => {
            const messages = await getDeadMessages(fixture.baseUrl);
            return messages.some(message => message.agent === 'reviewer') ? messages : undefined;
        }, 10_000);

        assert.match(response.message, /FAKE_RESPONSE:start review/);
        assert.ok(deadMessages.some(message => message.agent === 'reviewer'));
    } finally {
        await processor?.stop();
        await fixture.cleanup();
    }
});
