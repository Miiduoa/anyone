const test = require('node:test');
const assert = require('node:assert/strict');

const {
  secureEqual,
  randomToken,
  isOriginAllowed
} = require('../security');

test('secureEqual matches equal secrets', () => {
  assert.equal(secureEqual('correct-horse', 'correct-horse'), true);
  assert.equal(secureEqual('correct-horse', 'wrong'), false);
});

test('randomToken returns fixed-length high-entropy identifiers', () => {
  const first = randomToken(32);
  const second = randomToken(32);

  assert.equal(first.length, 32);
  assert.equal(second.length, 32);
  assert.notEqual(first, second);
});

test('development can run without a CORS whitelist', () => {
  assert.equal(
    isOriginAllowed(
      'http://localhost:3000',
      [],
      false
    ),
    true
  );
});

test('production only accepts configured browser origins', () => {
  const allowed = ['https://example.com'];

  assert.equal(
    isOriginAllowed(
      'https://example.com',
      allowed,
      true
    ),
    true
  );

  assert.equal(
    isOriginAllowed(
      'https://evil.example',
      allowed,
      true
    ),
    false
  );
});

test('requests without Origin remain available to non-browser clients', () => {
  assert.equal(
    isOriginAllowed(undefined, [], true),
    true
  );
});
