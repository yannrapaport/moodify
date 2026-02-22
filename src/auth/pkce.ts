import { randomBytes, createHash } from 'crypto';

export function generateVerifier(): string {
  return randomBytes(64).toString('base64url');
}

export function generateChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildSpotifyAuthUrl(
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string,
  scopes: string[],
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: scopes.join(' '),
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}
