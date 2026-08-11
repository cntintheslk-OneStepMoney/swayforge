'use strict';

const SENSITIVE_QUERY_KEY = '(?:access_token|refresh_token|client_secret|token|code|password|secret)';

function redactSensitiveText(value) {
  let text = typeof value === 'string' ? value : String(value ?? '');
  text = text.replace(/\bAuthorization\s*:\s*[^\r\n]+/gi, 'Authorization: [REDACTED]');
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]');
  text = text.replace(/\bCookie\s*:\s*[^\r\n]+/gi, 'Cookie: [REDACTED]');
  text = text.replace(new RegExp(`([?&]${SENSITIVE_QUERY_KEY}=)[^&#\\s]+`, 'gi'), '$1[REDACTED]');
  return text;
}

function serialiseSecretError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'SECRET_STORAGE_ERROR';
  const safeMessages = Object.freeze({
    SECRET_STORAGE_UNAVAILABLE: 'Protected credential storage is unavailable on this device.',
    SECRET_STORAGE_FAILED: 'Protected credential storage could not be used safely.',
    SECRET_NOT_FOUND: 'The requested credential no longer exists.',
    SECRET_PROTECTION_FAILED: 'The credential could not be protected safely.',
    SECRET_DECRYPTION_FAILED: 'The credential could not be opened safely.',
    SECRET_STORE_CORRUPT: 'Protected credential metadata could not be validated safely.'
  });
  return Object.freeze({
    code: Object.hasOwn(safeMessages, code) ? code : 'SECRET_STORAGE_ERROR',
    message: safeMessages[code] ?? 'The protected credential operation could not be completed safely.'
  });
}

module.exports = { redactSensitiveText, serialiseSecretError };
