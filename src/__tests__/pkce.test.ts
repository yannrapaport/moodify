import { describe, it, expect } from 'vitest';
import { generateVerifier, generateChallenge, buildSpotifyAuthUrl } from '../auth/pkce.js';

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

describe('generateVerifier', () => {
  it('returns a base64url string', () => {
    const v = generateVerifier();
    expect(BASE64URL_RE.test(v)).toBe(true);
  });

  it('is at least 43 characters (PKCE minimum from 32 bytes)', () => {
    const v = generateVerifier();
    // 64 random bytes → base64url → 86 chars (no padding)
    expect(v.length).toBeGreaterThanOrEqual(43);
  });

  it('generates a unique value each call', () => {
    expect(generateVerifier()).not.toBe(generateVerifier());
  });
});

describe('generateChallenge', () => {
  it('returns a base64url string', () => {
    const v = generateVerifier();
    const c = generateChallenge(v);
    expect(BASE64URL_RE.test(c)).toBe(true);
  });

  it('is deterministic for the same verifier', () => {
    const v = generateVerifier();
    expect(generateChallenge(v)).toBe(generateChallenge(v));
  });

  it('produces different challenges for different verifiers', () => {
    const c1 = generateChallenge(generateVerifier());
    const c2 = generateChallenge(generateVerifier());
    expect(c1).not.toBe(c2);
  });

  it('produces a SHA-256 base64url output (43 chars, no padding)', () => {
    // SHA-256 → 32 bytes → base64url → 43 chars (256 bits / 6 bits per char, ceil)
    const v = generateVerifier();
    const c = generateChallenge(v);
    expect(c.length).toBe(43);
  });

  it('matches RFC 7636 Appendix B known test vector', () => {
    // From https://www.rfc-editor.org/rfc/rfc7636#appendix-B
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
    expect(generateChallenge(verifier)).toBe(expectedChallenge);
  });
});

describe('buildSpotifyAuthUrl', () => {
  it('constructs a valid Spotify authorization URL', () => {
    const url = buildSpotifyAuthUrl(
      'test-client-id',
      'http://localhost:3000/auth/callback',
      'challenge123',
      'state456',
      ['user-read-playback-state', 'user-modify-playback-state'],
    );

    expect(url).toContain('https://accounts.spotify.com/authorize');
    expect(url).toContain('client_id=test-client-id');
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('code_challenge=challenge123');
    expect(url).toContain('state=state456');
    expect(url).toContain('response_type=code');
  });

  it('includes all requested scopes joined by space', () => {
    const scopes = ['user-read-playback-state', 'user-library-read'];
    const url = buildSpotifyAuthUrl('id', 'http://localhost', 'ch', 'st', scopes);
    const parsed = new URL(url);
    const scope = parsed.searchParams.get('scope');
    expect(scope).toBe('user-read-playback-state user-library-read');
  });

  it('includes the redirect URI', () => {
    const redirectUri = 'http://localhost:3000/auth/callback';
    const url = buildSpotifyAuthUrl('id', redirectUri, 'ch', 'st', []);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('redirect_uri')).toBe(redirectUri);
  });
});
