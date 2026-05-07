import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock setup ────────────────────────────────────────────────────────────────
// All Spotify network calls are intercepted via these mocks. No real HTTP
// reaches api.spotify.com.

vi.mock('../db/queries.js', () => ({
  getTokens: vi.fn(),
  getFeedbackByRating: vi.fn(() => []),
  getAllExclusions: vi.fn(() => []),
}));

vi.mock('../services/spotify.js', () => ({
  getClient: vi.fn(),
  spotifyFetch: vi.fn(),
}));

vi.mock('../services/recommendation.js', () => ({
  buildTasteProfile: vi.fn(() => ({ energy: 0.5, valence: 0.5, danceability: 0.5, acousticness: 0.5, instrumentalness: 0.5, tempo: 0.5, sampleSize: 0 })),
  getRecommendations: vi.fn(async () => []),
  filterExclusions: vi.fn(async (t: any[]) => t),
}));

import { Hono } from 'hono';
import { g2Router } from '../api/g2.js';
import * as queries from '../db/queries.js';
import * as spotifyService from '../services/spotify.js';

const getTokens = vi.mocked(queries.getTokens);
const getFeedbackByRating = vi.mocked(queries.getFeedbackByRating);
const getAllExclusions = vi.mocked(queries.getAllExclusions);
const getClient = vi.mocked(spotifyService.getClient);
const spotifyFetch = vi.mocked(spotifyService.spotifyFetch);

const TEST_KEY = 'test-api-key';
const AUTH = `Bearer ${TEST_KEY}`;

// Build a Hono app mounted exactly the same way as production: /api/g2/*
// This exercises the router's internal apiKeyAuth() middleware.
function buildApp() {
  const app = new Hono();
  app.route('/api/g2', g2Router);
  return app;
}

// Helpers to fabricate a SpotifyApi-like client. Each test only fills in the
// methods it actually exercises.
function makeClientStub(over: Record<string, any> = {}) {
  return {
    player: {
      getCurrentlyPlayingTrack: vi.fn(),
      getPlaybackState: vi.fn(),
      pausePlayback: vi.fn(async () => {}),
      startResumePlayback: vi.fn(async () => {}),
      skipToNext: vi.fn(async () => {}),
      skipToPrevious: vi.fn(async () => {}),
      ...over.player,
    },
    currentUser: {
      tracks: {
        hasSavedTracks: vi.fn(async () => [false]),
        saveTracks: vi.fn(async () => {}),
        ...over.currentUserTracks,
      },
      topItems: vi.fn(),
      ...over.currentUser,
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MCP_API_KEY = TEST_KEY;
  // Default: tokens exist (Spotify connected). Tests can override.
  getTokens.mockReturnValue({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() / 1000 + 3600 });
});

afterEach(() => {
  delete process.env.MCP_API_KEY;
});

// ── Auth tests ────────────────────────────────────────────────────────────────

describe('auth middleware', () => {
  it('returns 401 when no Authorization header is provided', async () => {
    const app = buildApp();
    const res = await app.request('/api/g2/now-playing');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the bearer token does not match MCP_API_KEY', async () => {
    const app = buildApp();
    const res = await app.request('/api/g2/now-playing', {
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });
});

// ── 503 spotify_not_connected ────────────────────────────────────────────────

describe('503 spotify_not_connected', () => {
  it('returns 503 with error=spotify_not_connected when getTokens() is null', async () => {
    getTokens.mockReturnValue(null);
    const app = buildApp();
    const res = await app.request('/api/g2/now-playing', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: 'spotify_not_connected' });
  });
});

// ── Endpoint happy paths ─────────────────────────────────────────────────────

describe('GET /api/g2/now-playing', () => {
  it('returns track info with isLiked + coverUrl + progress when something is playing', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue({
      is_playing: true,
      progress_ms: 12345,
      device: { id: 'd1' },
      item: {
        id: 't123',
        name: 'Strobe',
        type: 'track',
        duration_ms: 600000,
        artists: [{ name: 'Deadmau5' }],
        album: {
          name: 'For Lack of a Better Name',
          images: [
            { url: 'https://i.scdn.co/image/big.jpg', width: 640, height: 640 },
            { url: 'https://i.scdn.co/image/mid.jpg', width: 300, height: 300 },
            { url: 'https://i.scdn.co/image/sm.jpg', width: 64, height: 64 },
          ],
        },
      },
    });
    client.currentUser.tracks.hasSavedTracks.mockResolvedValue([true]);
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/now-playing', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isPlaying: true,
      track: {
        id: 't123',
        name: 'Strobe',
        artists: ['Deadmau5'],
        albumName: 'For Lack of a Better Name',
        isLiked: true,
        coverUrl: 'https://i.scdn.co/image/mid.jpg',
      },
      progressMs: 12345,
      durationMs: 600000,
    });
  });

  it('returns coverUrl=null when album has no images', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue({
      is_playing: true,
      progress_ms: 0,
      device: { id: 'd1' },
      item: {
        id: 't1',
        name: 'X',
        type: 'track',
        duration_ms: 1000,
        artists: [],
        album: { name: 'Y', images: [] },
      },
    });
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/now-playing', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.track.coverUrl).toBeNull();
  });

  it('returns track:null + null progress when nothing is playing', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue(null);
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/now-playing', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      isPlaying: false,
      track: null,
      progressMs: null,
      durationMs: null,
    });
  });
});

describe('POST /api/g2/play-pause', () => {
  it('pauses when currently playing', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue({ is_playing: true, device: { id: 'd1' } });
    getClient.mockResolvedValue(client);
    spotifyFetch.mockResolvedValue(new Response(null, { status: 204 }));

    const app = buildApp();
    const res = await app.request('/api/g2/play-pause', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isPlaying: false });
    expect(spotifyFetch).toHaveBeenCalledWith('/me/player/pause', { method: 'PUT' });
  });

  it('resumes when currently paused', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue({ is_playing: false, device: { id: 'd1' } });
    getClient.mockResolvedValue(client);
    spotifyFetch.mockResolvedValue(new Response(null, { status: 204 }));

    const app = buildApp();
    const res = await app.request('/api/g2/play-pause', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isPlaying: true });
    expect(spotifyFetch).toHaveBeenCalledWith('/me/player/play', { method: 'PUT' });
  });

  it('transfers playback to first available device when no active device', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue(null);
    getClient.mockResolvedValue(client);
    // First call: GET /me/player/devices, second: PUT /me/player (transfer)
    spotifyFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ devices: [{ id: 'phone-id', is_active: false }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const app = buildApp();
    const res = await app.request('/api/g2/play-pause', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isPlaying: true });
    expect(spotifyFetch).toHaveBeenNthCalledWith(1, '/me/player/devices', { method: 'GET' });
    expect(spotifyFetch).toHaveBeenNthCalledWith(2, '/me/player', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ device_ids: ['phone-id'], play: true }),
    }));
  });

  it('returns 503 no_device when no device is available', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue(null);
    getClient.mockResolvedValue(client);
    spotifyFetch.mockResolvedValue(
      new Response(JSON.stringify({ devices: [] }), { status: 200 }),
    );

    const app = buildApp();
    const res = await app.request('/api/g2/play-pause', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'no_device' });
  });
});

describe('GET /api/g2/playlists', () => {
  it('returns the user\'s playlists, mapped to the G2 shape', async () => {
    spotifyFetch.mockResolvedValue(new Response(JSON.stringify({
      items: [
        { id: 'p1', name: 'Chill', uri: 'spotify:playlist:p1', tracks: { total: 42 } },
        { id: 'p2', name: 'Workout', uri: 'spotify:playlist:p2', tracks: { total: 17 } },
      ],
    }), { status: 200 }));

    const app = buildApp();
    const res = await app.request('/api/g2/playlists', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      playlists: [
        { id: 'p1', name: 'Chill', uri: 'spotify:playlist:p1', trackCount: 42 },
        { id: 'p2', name: 'Workout', uri: 'spotify:playlist:p2', trackCount: 17 },
      ],
    });
    expect(spotifyFetch).toHaveBeenCalledWith('/me/playlists?limit=20', { method: 'GET' });
  });

  it('returns 500 when Spotify responds non-OK', async () => {
    spotifyFetch.mockResolvedValue(new Response('forbidden', { status: 403 }));
    const app = buildApp();
    const res = await app.request('/api/g2/playlists', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'spotify_403' });
  });
});

describe('POST /api/g2/play-context', () => {
  it('starts playback on the given context_uri', async () => {
    spotifyFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const app = buildApp();
    const res = await app.request('/api/g2/play-context', {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ contextUri: 'spotify:playlist:p1' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(spotifyFetch).toHaveBeenCalledWith('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify({ context_uri: 'spotify:playlist:p1' }),
    });
  });

  it('returns 400 when contextUri is missing', async () => {
    const app = buildApp();
    const res = await app.request('/api/g2/play-context', {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_contextUri' });
  });

  it('returns 503 no_device when Spotify replies 404', async () => {
    spotifyFetch.mockResolvedValue(new Response('no active device', { status: 404 }));
    const app = buildApp();
    const res = await app.request('/api/g2/play-context', {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ contextUri: 'spotify:playlist:p1' }),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'no_device' });
  });
});

describe('POST /api/g2/next', () => {
  it('skips to the next track and returns ok', async () => {
    spotifyFetch.mockResolvedValue(new Response(null, { status: 204 }));

    const app = buildApp();
    const res = await app.request('/api/g2/next', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(spotifyFetch).toHaveBeenCalledWith('/me/player/next', { method: 'POST' });
  });
});

describe('POST /api/g2/prev', () => {
  it('skips to the previous track and returns ok', async () => {
    spotifyFetch.mockResolvedValue(new Response(null, { status: 204 }));

    const app = buildApp();
    const res = await app.request('/api/g2/prev', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(spotifyFetch).toHaveBeenCalledWith('/me/player/previous', { method: 'POST' });
  });
});

describe('POST /api/g2/like', () => {
  it('likes the currently playing track when no body is provided', async () => {
    const client = makeClientStub();
    client.player.getCurrentlyPlayingTrack.mockResolvedValue({
      is_playing: true,
      item: { id: 'current-id', name: 'X', type: 'track', artists: [], album: { name: '' } },
    });
    getClient.mockResolvedValue(client);
    spotifyFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const app = buildApp();
    const res = await app.request('/api/g2/like', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, trackId: 'current-id' });
    expect(spotifyFetch).toHaveBeenCalledWith('/me/tracks?ids=current-id', { method: 'PUT' });
  });

  it('uses the trackId from the request body when supplied', async () => {
    const client = makeClientStub();
    getClient.mockResolvedValue(client);
    spotifyFetch.mockResolvedValue(new Response(null, { status: 200 }));

    const app = buildApp();
    const res = await app.request('/api/g2/like', {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ trackId: 'explicit-id' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, trackId: 'explicit-id' });
    expect(spotifyFetch).toHaveBeenCalledWith('/me/tracks?ids=explicit-id', { method: 'PUT' });
    // Should NOT have polled for the current track since trackId was provided
    expect(client.player.getCurrentlyPlayingTrack).not.toHaveBeenCalled();
  });
});

describe('GET /api/g2/lyrics', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns plainLyrics + syncedLyrics on a 200 LRClib hit', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        plainLyrics: 'la la la',
        syncedLyrics: '[00:00.00]la la la',
      }), { status: 200 })
    ) as any;

    const app = buildApp();
    const res = await app.request('/api/g2/lyrics?trackName=Strobe&artistName=Deadmau5', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      plainLyrics: 'la la la',
      syncedLyrics: '[00:00.00]la la la',
    });
  });

  it('returns both null with status 200 when LRClib responds 404', async () => {
    globalThis.fetch = vi.fn(async () => new Response('not found', { status: 404 })) as any;

    const app = buildApp();
    const res = await app.request('/api/g2/lyrics?trackName=Unknown&artistName=Nobody', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plainLyrics: null, syncedLyrics: null });
  });

  it('returns 502 when LRClib fails (network/5xx)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as any;

    const app = buildApp();
    const res = await app.request('/api/g2/lyrics?trackName=X&artistName=Y', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'lyrics_unavailable' });
  });

  it('returns 400 when query params are missing', async () => {
    const app = buildApp();
    const res = await app.request('/api/g2/lyrics?trackName=OnlyTrack', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/g2/surprise-me', () => {
  it('cold-start: plays a top-tracks candidate and returns its info', async () => {
    getFeedbackByRating.mockReturnValue([]); // cold-start path
    getAllExclusions.mockReturnValue([]);

    const client = makeClientStub();
    client.currentUser.topItems.mockResolvedValue({
      items: [
        { id: 'top1', uri: 'spotify:track:top1', name: 'Top Hit', artists: [{ id: 'a1', name: 'Top Artist' }] },
      ],
    });
    getClient.mockResolvedValue(client);
    spotifyFetch.mockResolvedValue(new Response(null, { status: 204 }) as any);

    const app = buildApp();
    const res = await app.request('/api/g2/surprise-me', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      track: { name: 'Top Hit', artists: ['Top Artist'] },
    });
    // Verify we called Spotify's play endpoint with the chosen URI
    expect(spotifyFetch).toHaveBeenCalledWith(
      '/me/player/play',
      expect.objectContaining({ method: 'PUT' }),
    );
  });
});
