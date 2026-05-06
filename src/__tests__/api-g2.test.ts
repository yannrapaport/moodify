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
  it('returns track info with isLiked when something is playing', async () => {
    const client = makeClientStub();
    client.player.getCurrentlyPlayingTrack.mockResolvedValue({
      is_playing: true,
      item: {
        id: 't123',
        name: 'Strobe',
        type: 'track',
        artists: [{ name: 'Deadmau5' }],
        album: { name: 'For Lack of a Better Name' },
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
      },
    });
  });

  it('returns track:null when nothing is playing', async () => {
    const client = makeClientStub();
    client.player.getCurrentlyPlayingTrack.mockResolvedValue(null);
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/now-playing', {
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isPlaying: false, track: null });
  });
});

describe('POST /api/g2/play-pause', () => {
  it('pauses when currently playing', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue({ is_playing: true });
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/play-pause', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isPlaying: false });
    expect(client.player.pausePlayback).toHaveBeenCalledOnce();
  });

  it('resumes when currently paused', async () => {
    const client = makeClientStub();
    client.player.getPlaybackState.mockResolvedValue({ is_playing: false });
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/play-pause', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ isPlaying: true });
    expect(client.player.startResumePlayback).toHaveBeenCalledOnce();
  });
});

describe('POST /api/g2/next', () => {
  it('skips to the next track and returns ok', async () => {
    const client = makeClientStub();
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/next', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.player.skipToNext).toHaveBeenCalledOnce();
  });
});

describe('POST /api/g2/prev', () => {
  it('skips to the previous track and returns ok', async () => {
    const client = makeClientStub();
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/prev', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(client.player.skipToPrevious).toHaveBeenCalledOnce();
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

    const app = buildApp();
    const res = await app.request('/api/g2/like', {
      method: 'POST',
      headers: { authorization: AUTH },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, trackId: 'current-id' });
    expect(client.currentUser.tracks.saveTracks).toHaveBeenCalledWith(['current-id']);
  });

  it('uses the trackId from the request body when supplied', async () => {
    const client = makeClientStub();
    getClient.mockResolvedValue(client);

    const app = buildApp();
    const res = await app.request('/api/g2/like', {
      method: 'POST',
      headers: { authorization: AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ trackId: 'explicit-id' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, trackId: 'explicit-id' });
    expect(client.currentUser.tracks.saveTracks).toHaveBeenCalledWith(['explicit-id']);
    // Should NOT have polled for the current track since trackId was provided
    expect(client.player.getCurrentlyPlayingTrack).not.toHaveBeenCalled();
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
