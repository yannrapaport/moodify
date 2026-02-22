import { Hono } from 'hono';
import { generateVerifier, generateChallenge, buildSpotifyAuthUrl } from './pkce.js';
import { saveTokens } from './token-store.js';
import { randomBytes } from 'crypto';

const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-top-read',
  'user-read-recently-played',
];

interface PendingAuth {
  verifier: string;
  expiresAt: number;
}

// In-memory store for PKCE verifiers — keyed by state param, TTL 10 minutes
const pendingAuths = new Map<string, PendingAuth>();

function evictStaleEntries(): void {
  const now = Date.now();
  for (const [state, entry] of pendingAuths.entries()) {
    if (entry.expiresAt < now) pendingAuths.delete(state);
  }
}

export const authRouter = new Hono();

authRouter.get('/login', async (c) => {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return c.text('SPOTIFY_CLIENT_ID and SPOTIFY_REDIRECT_URI must be set', 500);
  }

  evictStaleEntries();

  const verifier = generateVerifier();
  const challenge = generateChallenge(verifier);
  const state = randomBytes(16).toString('hex');

  pendingAuths.set(state, {
    verifier,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  const url = buildSpotifyAuthUrl(clientId, redirectUri, challenge, state, SCOPES);
  return c.redirect(url);
});

authRouter.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) return c.text(`Spotify auth error: ${error}`, 400);
  if (!code || !state) return c.text('Missing code or state parameter', 400);

  const pending = pendingAuths.get(state);
  if (!pending) return c.text('Invalid or expired state — please restart the login flow', 400);
  if (pending.expiresAt < Date.now()) {
    pendingAuths.delete(state);
    return c.text('Auth session expired — please restart the login flow', 400);
  }

  pendingAuths.delete(state);

  const clientId = process.env.SPOTIFY_CLIENT_ID!;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI!;

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: pending.verifier,
    // No client_secret — PKCE flow is intentionally secret-free
  });

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    return c.text(`Token exchange failed: ${text}`, 400);
  }

  const data = await res.json() as any;
  saveTokens({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  });

  return c.html(`
    <html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>Authentication successful!</h2>
      <p>Moodify is now connected to Spotify. You can close this tab.</p>
    </body></html>
  `);
});
