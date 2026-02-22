import { SpotifyApi } from '@spotify/web-api-ts-sdk';
import { getTokens, saveTokens } from '../db/queries.js';

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID!;
const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';

// Concurrency guard: prevents simultaneous refresh races
let refreshPromise: Promise<void> | null = null;

async function refreshTokens(): Promise<void> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const tokens = getTokens();
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
    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
    });
  })().finally(() => {
    // Always reset — even on failure — to prevent permanent deadlock
    refreshPromise = null;
  });

  return refreshPromise;
}

export async function getClient(): Promise<SpotifyApi> {
  const tokens = getTokens();
  if (!tokens) throw new Error('Not authenticated — visit /auth/login');

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt <= nowSeconds + 60) {
    await refreshTokens();
  }

  const current = getTokens()!;
  return SpotifyApi.withAccessToken(CLIENT_ID, {
    access_token: current.accessToken,
    token_type: 'Bearer',
    expires_in: current.expiresAt - nowSeconds,
    refresh_token: current.refreshToken ?? '',
  });
}

/** Raw authenticated fetch for endpoints not covered by the SDK */
export async function spotifyFetch(path: string, init?: RequestInit): Promise<Response> {
  const tokens = getTokens();
  if (!tokens) throw new Error('Not authenticated — visit /auth/login');

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (tokens.expiresAt <= nowSeconds + 60) await refreshTokens();

  const current = getTokens()!;
  return fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${current.accessToken}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}
