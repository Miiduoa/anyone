const crypto = require('crypto');

function secureEqual(a, b) {
  const left = crypto
    .createHash('sha256')
    .update(String(a ?? ''), 'utf8')
    .digest();
  const right = crypto
    .createHash('sha256')
    .update(String(b ?? ''), 'utf8')
    .digest();

  return crypto.timingSafeEqual(left, right);
}

function randomToken(length = 32) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new TypeError('length must be a positive integer');
  }

  const bytes = Math.ceil((length * 3) / 4) + 2;
  return crypto
    .randomBytes(bytes)
    .toString('base64url')
    .slice(0, length);
}

function isOriginAllowed(
  origin,
  allowedOrigins,
  isProduction
) {
  if (!origin) return true;

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  return !isProduction && allowedOrigins.length === 0;
}

module.exports = {
  secureEqual,
  randomToken,
  isOriginAllowed
};
