import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/queries.js', () => ({
  getTokens: vi.fn(() => ({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() / 1000 + 3600 })),
  getFeedbackByRating: vi.fn(() => []),
  getAllExclusions: vi.fn(() => []),
  getUserByApiKey: vi.fn(),
  listTrails: vi.fn(() => []), upsertTrail: vi.fn(), deleteTrailForUser: vi.fn(),
}));
vi.mock('../services/spotify.js', () => ({ getClient: vi.fn(), spotifyFetch: vi.fn() }));
vi.mock('../services/recommendation.js', () => ({
  buildTasteProfile: vi.fn(() => ({})), getRecommendations: vi.fn(async () => []),
  filterExclusions: vi.fn(async (_u: number, t: any[]) => t),
}));
// stub le module d'extraction (pas de vrai pmtiles/réseau en test)
vi.mock('../services/map-extract.js', async (orig) => {
  const actual = await orig() as any;
  return {
    ...actual,
    resolvePlanetUrl: vi.fn(async () => 'https://build.protomaps.com/20260712.pmtiles'),
    extractBbox: vi.fn(async (_u: string, _b: number[], outPath: string) => {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(outPath, Buffer.from('PMTILES_FAKE'));
    }),
  };
});

import { Hono } from 'hono';
import { g2Router } from '../api/g2.js';
import * as queries from '../db/queries.js';
import { parseBbox } from '../services/map-extract.js';

const getUserByApiKey = vi.mocked(queries.getUserByApiKey);
const KEY = 'key-a';
function buildApp() { const app = new Hono(); app.route('/api/g2', g2Router); return app; }
beforeEach(() => { vi.clearAllMocks(); getUserByApiKey.mockImplementation((k: string) => (k === KEY ? { id: 1 } as any : null)); });

describe('parseBbox', () => {
  it('parse W,S,E,N', () => { expect(parseBbox('2.24,48.81,2.42,48.91')).toEqual([2.24,48.81,2.42,48.91]); });
  it('rejette format invalide', () => { expect(() => parseBbox('a,b')).toThrow('bad_bbox'); });
  it('rejette W>=E ou S>=N', () => { expect(() => parseBbox('3,48,2,49')).toThrow('bad_bbox'); });
  it('rejette aire trop grande', () => { expect(() => parseBbox('0,0,1,1')).toThrow('bbox_too_large'); });
});

describe('GET /api/g2/map/extract', () => {
  it('401 sans clé', async () => {
    const res = await buildApp().request('/api/g2/map/extract?bbox=2.24,48.81,2.42,48.91', { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });
  it('400 bbox invalide', async () => {
    const res = await buildApp().request('/api/g2/map/extract?bbox=oops', { headers: { authorization: `Bearer ${KEY}` } });
    expect(res.status).toBe(400);
  });
  it('200 + octets pmtiles (happy path stubbé)', async () => {
    const res = await buildApp().request('/api/g2/map/extract?bbox=2.24,48.81,2.42,48.91', { headers: { authorization: `Bearer ${KEY}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/octet-stream');
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe('PMTILES_FAKE');
  });
});
