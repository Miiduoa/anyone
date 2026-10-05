const crypto = require('crypto');

function normalizeText(value, maxLength) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeMessageInput(body = {}) {
  const isAdminPost = body.adminPost === true;
  const text = normalizeText(body.text, 500);
  const alias = normalizeText(body.alias, 16);
  const mood = normalizeText(body.mood || (isAdminPost ? '📣' : '💬'), 8);
  const mediaUrl = typeof body.mediaUrl === 'string'
    ? body.mediaUrl.trim().slice(0, 500)
    : '';

  return {
    text,
    alias,
    mood,
    isAdminPost,
    mediaUrl: isAdminPost && mediaUrl ? mediaUrl : null
  };
}

function normalizeIdempotencyKey(value) {
  if (Array.isArray(value)) value = value[0];
  if (typeof value !== 'string') return '';
  const key = value.trim();
  if (key.length < 8 || key.length > 128) return '';
  return key;
}

function hashOpaqueKey(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function createAuditEvent(action, messageId, detail = {}, now = Date.now()) {
  const safeDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (['status', 'fromStatus', 'toStatus', 'pinned', 'isAdminPost'].includes(key)) {
      safeDetail[key] = value;
    }
  }

  return {
    ts: now,
    action,
    messageId,
    detail: safeDetail
  };
}

module.exports = {
  normalizeMessageInput,
  normalizeIdempotencyKey,
  hashOpaqueKey,
  createAuditEvent
};
