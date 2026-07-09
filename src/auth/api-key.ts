import { randomBytes, createHash, timingSafeEqual } from 'crypto';

const API_KEY_PREFIX = 'mod_';

/** 32-byte random API key, prefixed for easy identification in headers/logs. */
export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/** sha256 of the API key, hex-encoded. Stored in the users table. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex');
}

/** Constant-time compare to avoid timing side-channels in the lookup. */
export function verifyApiKey(apiKey: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(apiKey), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
