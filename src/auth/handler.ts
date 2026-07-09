import { Hono } from 'hono';
import { generateVerifier, generateChallenge, buildSpotifyAuthUrl } from './pkce.js';
import { generateApiKey, hashApiKey } from './api-key.js';
import {
  saveTokens,
  upsertUserBySpotifyId,
  updateUserApiKeyHash,
  getUserBySpotifyId,
  getUserById,
  getUserByApiKey,
  deleteUser,
} from '../db/queries.js';
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

// One-shot tokens issued post-OAuth so the dashboard can display the freshly
// generated API key exactly once. Keyed by random token, TTL 5 minutes, deleted
// on first read.
interface OneShotKey {
  userId: number;
  apiKey: string;
  expiresAt: number;
}
const oneShotKeys = new Map<string, OneShotKey>();

function evictStaleEntries(): void {
  const now = Date.now();
  for (const [state, entry] of pendingAuths.entries()) {
    if (entry.expiresAt < now) pendingAuths.delete(state);
  }
  for (const [token, entry] of oneShotKeys.entries()) {
    if (entry.expiresAt < now) oneShotKeys.delete(token);
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
  const accessToken: string = data.access_token;
  const refreshToken: string | null = data.refresh_token ?? null;
  const expiresAt = Math.floor(Date.now() / 1000) + data.expires_in;

  // Identify the user by hitting /me with the new access_token.
  const meRes = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!meRes.ok) {
    return c.text(`Failed to fetch Spotify profile: ${await meRes.text()}`, 400);
  }
  const me = await meRes.json() as { id: string; display_name?: string; email?: string };

  // First-time user: generate an API key, create the user, show it once.
  // Returning user: keep their existing API key (don't rotate on re-login),
  // refresh display_name/email if Spotify has changes.
  const existing = getUserBySpotifyId(me.id);
  let displayedApiKey: string | null = null;

  let user;
  if (existing) {
    user = upsertUserBySpotifyId({
      spotifyUserId: me.id,
      displayName: me.display_name ?? null,
      email: me.email ?? null,
      apiKeyHash: existing.apiKeyHash, // ignored by upsert when row exists, but kept for clarity
    });
  } else {
    const apiKey = generateApiKey();
    user = upsertUserBySpotifyId({
      spotifyUserId: me.id,
      displayName: me.display_name ?? null,
      email: me.email ?? null,
      apiKeyHash: hashApiKey(apiKey),
    });
    displayedApiKey = apiKey;
  }

  saveTokens(user.id, { accessToken, refreshToken, expiresAt });

  // If we just minted a key, stash it for one-shot display on /dashboard.
  if (displayedApiKey) {
    const token = randomBytes(24).toString('base64url');
    oneShotKeys.set(token, {
      userId: user.id,
      apiKey: displayedApiKey,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });
    return c.redirect(`/dashboard?token=${encodeURIComponent(token)}`);
  }

  // Returning user — just confirm they're connected, no key to show.
  return c.redirect('/dashboard?welcome=back');
});

authRouter.post('/regenerate', async (c) => {
  // Authenticated via existing API key — user proves they own the account by
  // supplying their current key, which we then rotate.
  const auth = c.req.header('authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ error: 'unauthorized' }, 401);

  const user = getUserByApiKey(match[1]);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  const newKey = generateApiKey();
  updateUserApiKeyHash(user.id, hashApiKey(newKey));
  return c.json({ apiKey: newKey });
});

authRouter.post('/disconnect', async (c) => {
  // Same auth pattern as /regenerate — the user proves ownership with their
  // current API key, then we delete the account (cascades to tokens/etc).
  const auth = c.req.header('authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ error: 'unauthorized' }, 401);

  const user = getUserByApiKey(match[1]);
  if (!user) return c.json({ error: 'unauthorized' }, 401);

  deleteUser(user.id);
  return c.json({ ok: true });
});

/**
 * Consumes a one-shot dashboard token and returns the freshly-minted API key
 * exactly once. After this call the token is invalidated. Returns null if no
 * matching token (expired, already consumed, or never existed).
 */
export function consumeOneShotKey(token: string): { userId: number; apiKey: string } | null {
  evictStaleEntries();
  const entry = oneShotKeys.get(token);
  if (!entry) return null;
  oneShotKeys.delete(token);
  return { userId: entry.userId, apiKey: entry.apiKey };
}

export { getUserById };
