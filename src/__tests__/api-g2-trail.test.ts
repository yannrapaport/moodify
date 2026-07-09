import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/queries.js', () => ({
  getTokens: vi.fn(() => ({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() / 1000 + 3600 })),
  getFeedbackByRating: vi.fn(() => []),
  getAllExclusions: vi.fn(() => []),
  getUserByApiKey: vi.fn(),
}));
vi.mock('../services/spotify.js', () => ({ getClient: vi.fn(), spotifyFetch: vi.fn() }));
vi.mock('../services/recommendation.js', () => ({
  buildTasteProfile: vi.fn(() => ({})), getRecommendations: vi.fn(async () => []),
  filterExclusions: vi.fn(async (_u: number, t: any[]) => t),
}));

import { Hono } from 'hono';
import { g2Router } from '../api/g2.js';
import * as queries from '../db/queries.js';
import { _clearAllRides } from '../services/trail-ride-store.js';

const getUserByApiKey = vi.mocked(queries.getUserByApiKey);
const KEY_A = 'key-a', KEY_B = 'key-b';

function user(id: number) {
  return { id, spotifyUserId: 's', displayName: 'T', email: null, apiKeyHash: 'h', createdAt: 0 };
}
function buildApp() { const app = new Hono(); app.route('/api/g2', g2Router); return app; }
function ride(speed = 27) {
  return JSON.stringify({ session: { startedAt: 0, elapsedS: 60, movingTimeS: 55, distanceM: 400, avgSpeedKmh: 20, speedKmh: speed }, nav: null, headingDeg: 90, lat: 48, lon: 2, accuracyM: 6, updatedAt: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  _clearAllRides();
  getUserByApiKey.mockImplementation((k: string) => (k === KEY_A ? user(1) : k === KEY_B ? user(2) : null));
});

describe('POST/GET /api/g2/trail/ride', () => {
  it('round-trip : POST puis GET renvoie le même body + hash non nul', async () => {
    const app = buildApp();
    const post = await app.request('/api/g2/trail/ride', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' }, body: ride(27) });
    expect(post.status).toBe(204);
    const get = await app.request('/api/g2/trail/ride', { headers: { authorization: `Bearer ${KEY_A}` } });
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.data).toBe(ride(27));
    expect(body.hash).not.toBe('0');
  });

  it('isolation par tenant : le GET de B ne voit pas le POST de A', async () => {
    const app = buildApp();
    await app.request('/api/g2/trail/ride', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' }, body: ride(27) });
    const getB = await app.request('/api/g2/trail/ride', { headers: { authorization: `Bearer ${KEY_B}` } });
    expect(await getB.json()).toEqual({ data: null, hash: '0' });
  });

  it('POST null vide la boîte', async () => {
    const app = buildApp();
    await app.request('/api/g2/trail/ride', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' }, body: ride(27) });
    await app.request('/api/g2/trail/ride', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' }, body: 'null' });
    const get = await app.request('/api/g2/trail/ride', { headers: { authorization: `Bearer ${KEY_A}` } });
    expect(await get.json()).toEqual({ data: null, hash: '0' });
  });

  it('401 sans clé', async () => {
    const app = buildApp();
    const res = await app.request('/api/g2/trail/ride', { headers: { authorization: 'Bearer wrong' } });
    expect(res.status).toBe(401);
  });

  it('400 sur body JSON invalide', async () => {
    const app = buildApp();
    const res = await app.request('/api/g2/trail/ride', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' }, body: '{not json' });
    expect(res.status).toBe(400);
  });
});
