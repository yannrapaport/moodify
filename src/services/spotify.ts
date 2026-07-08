import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { getTokens, saveTokens } from '../db/queries.js';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

// Concurrency guard, per user: prevents simultaneous refresh races for the same
// account. Different users get independent promises.
const refreshPromises = new Map<number, Promise<void>>();

async function refreshTokens(userId: number): Promise<void> {
  const existing = refreshPromises.get(userId);
  if (existing) return existing;

  const promise = (async () => {
    const tokens = getTokens(userId);
    if (!tokens?.refreshToken) throw new Error('No refresh token available — visit /auth/login');

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: CLIENT_ID,
    });

    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as any;
    saveTokens(userId, {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    });
  })().finally(() => {
    refreshPromises.delete(userId);
  });

  refreshPromises.set(userId, promise);
  return promise;
}

export async function getClient(userId: number): Promise<SpotifyApi> {
  const tokens = getTokens(userId);
  if (!tokens) throw new Error('Not authenticated — visit /auth/login');

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt <= nowSeconds + 60) {
    await refreshTokens(userId);
  }

  const current = getTokens(userId)!;
  return SpotifyApi.withAccessToken(CLIENT_ID, {
    access_token: current.accessToken,
    token_type: 'Bearer',
    expires_in: current.expiresAt - nowSeconds,
    refresh_token: current.refreshToken ?? '',
  });
}

/** Raw authenticated fetch for endpoints not covered by the SDK */
export async function spotifyFetch(userId: number, path: string, init?: RequestInit): Promise<Response> {
  const tokens = getTokens(userId);
  if (!tokens) throw new Error('Not authenticated — visit /auth/login');

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt <= nowSeconds + 60) await refreshTokens(userId);

  const current = getTokens(userId)!;
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${current.accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}
