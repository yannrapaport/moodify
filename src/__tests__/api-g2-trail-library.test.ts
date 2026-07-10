import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock better-sqlite3-backed queries EXCEPT the trail ones, which we test through
// a real in-memory DB. Simplest: mock getUserByApiKey for auth, and use the real
// query functions against an in-memory DB seeded here.
vi.mock('../services/spotify.js', () => ({ getClient: vi.fn(), spotifyFetch: vi.fn() }));
vi.mock('../services/recommendation.js', () => ({
  buildTasteProfile: vi.fn(() => ({})), getRecommendations: vi.fn(async () => []),
  filterExclusions: vi.fn(async (_u: number, t: any[]) => t),
}));

import { Hono } from 'hono';

// Real DB in-memory for this test file.
process.env.DB_PATH = ':memory:';

import { g2Router } from '../api/g2.js';
import * as queries from '../db/queries.js';
import { getDb } from '../db/index.js';

const KEY_A = 'key-a', KEY_B = 'key-b';

function buildApp() { const app = new Hono(); app.route('/api/g2', g2Router); return app; }
function seedUsers() {
  const db = getDb();
  db.exec("INSERT OR IGNORE INTO users (id, spotify_user_id, api_key_hash) VALUES (1,'sa','" + hash(KEY_A) + "'),(2,'sb','" + hash(KEY_B) + "')");
}
// getUserByApiKey hashes the key with sha256 — replicate so seeded hashes match.
import { createHash } from 'crypto';
function hash(k: string) { return createHash('sha256').update(k).digest('hex'); }

function trail(id = 't1', name = 'Boucle') {
  return { id, name, points: [{ lat: 48, lon: 2 }, { lat: 48.1, lon: 2.1 }], totalDistanceM: 4200, elevationGainM: 80, createdAt: 100 };
}

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM trails; DELETE FROM users;');
  seedUsers();
});

describe('trail library CRUD', () => {
  it('POST puis GET renvoie le parcours pour le bon tenant', async () => {
    const app = buildApp();
    const post = await app.request('/api/g2/trail/library', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' }, body: JSON.stringify(trail()) });
    expect(post.status).toBe(204);
    const get = await app.request('/api/g2/trail/library', { headers: { authorization: `Bearer ${KEY_A}` } });
    expect(get.status).toBe(200);
    const body = await get.json();
    expect(body.trails).toHaveLength(1);
    expect(body.trails[0].id).toBe('t1');
    expect(body.trails[0].points).toHaveLength(2);
    expect(body.trails[0].totalDistanceM).toBe(4200);
  });

  it('isolation par tenant : B ne voit pas les parcours de A', async () => {
    const app = buildApp();
    await app.request('/api/g2/trail/library', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' }, body: JSON.stringify(trail()) });
    const getB = await app.request('/api/g2/trail/library', { headers: { authorization: `Bearer ${KEY_B}` } });
    expect((await getB.json()).trails).toHaveLength(0);
  });

  it('POST du même id = upsert (pas de doublon)', async () => {
    const app = buildApp();
    const h = { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' };
    await app.request('/api/g2/trail/library', { method: 'POST', headers: h, body: JSON.stringify(trail('t1', 'v1')) });
    await app.request('/api/g2/trail/library', { method: 'POST', headers: h, body: JSON.stringify(trail('t1', 'v2')) });
    const body = await (await app.request('/api/g2/trail/library', { headers: { authorization: `Bearer ${KEY_A}` } })).json();
    expect(body.trails).toHaveLength(1);
    expect(body.trails[0].name).toBe('v2');
  });

  it('DELETE supprime le parcours', async () => {
    const app = buildApp();
    const h = { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' };
    await app.request('/api/g2/trail/library', { method: 'POST', headers: h, body: JSON.stringify(trail()) });
    const del = await app.request('/api/g2/trail/library/t1', { method: 'DELETE', headers: { authorization: `Bearer ${KEY_A}` } });
    expect(del.status).toBe(204);
    expect((await (await app.request('/api/g2/trail/library', { headers: { authorization: `Bearer ${KEY_A}` } })).json()).trails).toHaveLength(0);
  });

  it('401 sans clé', async () => {
    const app = buildApp();
    expect((await app.request('/api/g2/trail/library')).status).toBe(401);
  });

  it('400 sur body invalide', async () => {
    const app = buildApp();
    const res = await app.request('/api/g2/trail/library', { method: 'POST', headers: { authorization: `Bearer ${KEY_A}`, 'content-type': 'application/json' }, body: '{"name":"x"}' });
    expect(res.status).toBe(400);
  });
});
