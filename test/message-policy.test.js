const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeMessageInput,
  normalizeIdempotencyKey,
  hashOpaqueKey,
  createAuditEvent
} = require('../message-policy');

test('normalizes whitespace and limits public fields', () => {
  const input = normalizeMessageInput({
    text: '  hello   world  ',
    alias: '  guest  ',
    mood: '💬'
  });

  assert.equal(input.text, 'hello world');
  assert.equal(input.alias, 'guest');
  assert.equal(input.isAdminPost, false);
  assert.equal(input.mediaUrl, null);
});

test('media url is only accepted for admin posts', () => {
  assert.equal(
    normalizeMessageInput({ text: 'x', mediaUrl: '/media/a.png' }).mediaUrl,
    null
  );

  assert.equal(
    normalizeMessageInput({
      text: 'x',
      adminPost: true,
      mediaUrl: '/media/a.png'
    }).mediaUrl,
    '/media/a.png'
  );
});

test('idempotency keys require a reasonable length', () => {
  assert.equal(normalizeIdempotencyKey('short'), '');
  assert.equal(normalizeIdempotencyKey(' order-20261005-001 '), 'order-20261005-001');
  assert.equal(hashOpaqueKey('same-key'), hashOpaqueKey('same-key'));
  assert.notEqual(hashOpaqueKey('same-key'), hashOpaqueKey('other-key'));
});

test('audit events never copy arbitrary detail fields', () => {
  const event = createAuditEvent(
    'status_changed',
    'm1',
    {
      fromStatus: 'pending',
      toStatus: 'public',
      text: 'private message body',
      ip: '127.0.0.1'
    },
    123
  );

  assert.deepEqual(event, {
    ts: 123,
    action: 'status_changed',
    messageId: 'm1',
    detail: {
      fromStatus: 'pending',
      toStatus: 'public'
    }
  });
});
