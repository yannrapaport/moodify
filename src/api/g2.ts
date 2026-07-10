import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { userApiKeyAuth } from '../middleware/api-key.js';
import { getTokens } from '../db/queries.js';
import { getClient, spotifyFetch } from '../services/spotify.js';
import { buildTasteProfile, getRecommendations, filterExclusions } from '../services/recommendation.js';
import { getFeedbackByRating, getAllExclusions } from '../db/queries.js';
import { listTrails, upsertTrail, deleteTrailForUser, type Trail } from '../db/queries.js';
import { putRide, getRide } from '../services/trail-ride-store.js';

/**
 * REST sub-router for the Even Realities G2 plugin.
 *
 * Mounted at /api/g2 on the main Hono app. Auth: `Authorization: Bearer
 * <user-api-key>` — the API key resolves to a user, scoping all operations.
 */
type G2Env = { Variables: { userId: number } };
export const g2Router = new Hono<G2Env>();

g2Router.use('*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  maxAge: 600,
}));
g2Router.use('*', userApiKeyAuth());

// Helper: short-circuit if Spotify is not connected for this user (no tokens).
function ensureSpotifyConnected(userId: number): boolean {
  return getTokens(userId) !== null;
}

// Centralized error mapping. 503 for "not connected", 500 for everything else.
function errorResponse(c: Context, e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('Not authenticated') || msg.includes('No refresh token')) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }
  return c.json({ error: msg }, 500);
}

// ── GET /now-playing ─────────────────────────────────────────────────────────
g2Router.get('/now-playing', async (c) => {
  const userId = c.get('userId');
  if (!ensureSpotifyConnected(userId)) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    const client = await getClient(userId);
    // getPlaybackState() (vs getCurrentlyPlayingTrack) is the canonical source
    // for progress_ms — it stays accurate while paused and updates more
    // reliably across device transfers.
    const state = await client.player.getPlaybackState() as any;

    // No active playback context, or no track in the slot
    if (!state || !state.item) {
      return c.json({ isPlaying: false, track: null, progressMs: null, durationMs: null });
    }

    const item = state.item as any; // SDK union: TrackItem = Track | Episode

    // Likes only apply to tracks (not episodes); guard so we don't blow up
    // on podcast playback.
    let isLiked = false;
    if (item.id && item.type !== 'episode') {
      try {
        const liked = await client.currentUser.tracks.hasSavedTracks([item.id]);
        isLiked = !!liked[0];
      } catch {
        // Non-fatal: report isLiked=false rather than fail the whole call.
        isLiked = false;
      }
    }

    // Pick the album cover closest to 300px wide (G2 renders it at 144px,
    // so 300px gives us decent quality without being wasteful to fetch).
    const images = (item.album?.images ?? []) as Array<{ url: string; width: number; height: number }>;
    let coverUrl: string | null = null;
    if (images.length > 0) {
      const best = [...images].sort(
        (a, b) => Math.abs((a.width ?? 0) - 300) - Math.abs((b.width ?? 0) - 300),
      )[0];
      coverUrl = best?.url ?? null;
    }

    const progressMs = typeof state.progress_ms === 'number' ? state.progress_ms : null;
    const durationMs = typeof item.duration_ms === 'number' ? item.duration_ms : null;

    return c.json({
      isPlaying: !!state.is_playing,
      track: {
        id: item.id ?? '',
        name: item.name ?? '',
        artists: (item.artists ?? []).map((a: any) => a.name),
        albumName: item.album?.name ?? '',
        isLiked,
        coverUrl,
      },
      progressMs,
      durationMs,
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /play-pause ─────────────────────────────────────────────────────────
//
// Three-way handling:
//  1. State exists & is_playing=true  -> pause normally
//  2. State exists & is_playing=false -> resume normally
//  3. No state OR state.device is null -> "no active device" path:
//     fetch /me/player/devices, transfer playback to the first available one
//     with play=true. If no device is available, return 503 {error:'no_device'}.
g2Router.post('/play-pause', async (c) => {
  const userId = c.get('userId');
  if (!ensureSpotifyConnected(userId)) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    const client = await getClient(userId);
    const state = await client.player.getPlaybackState() as any;
    const hasActiveDevice = !!(state && state.device);

    if (!hasActiveDevice) {
      // No active device path — try transferring to any known device.
      const res = await spotifyFetch(userId, '/me/player/devices', { method: 'GET' });
      if (!res.ok) {
        return c.json({ error: 'no_device' }, 503);
      }
      const data = await res.json() as { devices?: Array<{ id: string; is_active: boolean }> };
      const devices = data.devices ?? [];
      if (devices.length === 0) {
        return c.json({ error: 'no_device' }, 503);
      }
      const target = devices[0];
      await spotifyFetch(userId, '/me/player', {
        method: 'PUT',
        body: JSON.stringify({ device_ids: [target.id], play: true }),
      });
      return c.json({ isPlaying: true });
    }

    const currentlyPlaying = !!state.is_playing;

    // Use raw fetch — the SDK chokes parsing Spotify's 204/empty-body responses
    // for player control endpoints.
    if (currentlyPlaying) {
      await spotifyFetch(userId, '/me/player/pause', { method: 'PUT' });
      return c.json({ isPlaying: false });
    }
    await spotifyFetch(userId, '/me/player/play', { method: 'PUT' });
    return c.json({ isPlaying: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /next ───────────────────────────────────────────────────────────────
g2Router.post('/next', async (c) => {
  const userId = c.get('userId');
  if (!ensureSpotifyConnected(userId)) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    await spotifyFetch(userId, '/me/player/next', { method: 'POST' });
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /prev ───────────────────────────────────────────────────────────────
g2Router.post('/prev', async (c) => {
  const userId = c.get('userId');
  if (!ensureSpotifyConnected(userId)) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    await spotifyFetch(userId, '/me/player/previous', { method: 'POST' });
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /like ───────────────────────────────────────────────────────────────
g2Router.post('/like', async (c) => {
  const userId = c.get('userId');
  if (!ensureSpotifyConnected(userId)) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    // Optional body { trackId } — falls back to currently-playing track.
    let trackId: string | undefined;
    try {
      const body = await c.req.json<{ trackId?: string }>();
      trackId = body?.trackId;
    } catch {
      // No body / invalid JSON — fine, we'll resolve from playback state.
    }

    const client = await getClient(userId);

    if (!trackId) {
      const state = await client.player.getCurrentlyPlayingTrack();
      const item = state?.item as any;
      if (!item?.id) {
        return c.json({ error: 'no_current_track' }, 500);
      }
      trackId = item.id as string;
    }

    // Raw fetch — SDK saveTracks chokes on Spotify's empty 200 response.
    await spotifyFetch(userId, `/me/tracks?ids=${encodeURIComponent(trackId)}`, { method: 'PUT' });
    return c.json({ ok: true, trackId });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /surprise-me ────────────────────────────────────────────────────────
// REST equivalent of the MCP `surprise_me` tool. Picks a track via the existing
// recommendation engine, starts playback, and queues 7 more in the background.
g2Router.post('/surprise-me', async (c) => {
  const userId = c.get('userId');
  if (!ensureSpotifyConnected(userId)) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    let context: string | undefined;
    try {
      const body = await c.req.json<{ context?: string }>();
      context = body?.context;
    } catch { /* no body — fine */ }

    const liked = getFeedbackByRating(userId, 1);
    const isColdStart = liked.length === 0;

    let firstUri = '';
    let firstName = '';
    let firstArtists: string[] = [];

    if (isColdStart) {
      // Pick randomly from eligible top tracks (not always index 0).
      const client = await getClient(userId);
      const top = await client.currentUser.topItems('tracks', 'short_term', 10);
      const exclusions = getAllExclusions(userId);
      const excludedArtists = new Set(exclusions.filter((e) => e.type === 'artist').map((e) => e.value));
      const excludedTracks = new Set(exclusions.filter((e) => e.type === 'track').map((e) => e.value));

      const eligible = top.items.filter((t) =>
        !excludedTracks.has(t.id) && !t.artists.some((a) => excludedArtists.has(a.id)),
      );
      if (!eligible.length) {
        return c.json({ error: 'no_suitable_tracks' }, 500);
      }
      const candidate = eligible[Math.floor(Math.random() * eligible.length)];
      firstUri = candidate.uri;
      firstName = candidate.name;
      firstArtists = candidate.artists.map((a) => a.name);
    } else {
      // Pick randomly from up to 20 liked tracks (not always the same #1).
      const pool = liked.slice(0, 20);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      firstUri = `spotify:track:${pick.trackId}`;
      firstName = pick.trackName;
      firstArtists = [pick.artistName];
    }

    // Start playback (track URI → uris payload, otherwise context_uri)
    const playBody = firstUri.includes(':track:') ? { uris: [firstUri] } : { context_uri: firstUri };
    await spotifyFetch(userId, '/me/player/play', {
      method: 'PUT',
      body: JSON.stringify(playBody),
    });

    // Fire-and-forget queue building. Mirrors the MCP tool behavior.
    setImmediate(async () => {
      try {
        const profile = buildTasteProfile(userId);
        const recs = await getRecommendations(userId, profile, context);
        const filtered = await filterExclusions(userId, recs);
        const toQueue = filtered.filter((t) => t.uri !== firstUri).slice(0, 7);
        for (const track of toQueue) {
          await spotifyFetch(userId, '/me/player/queue?' + new URLSearchParams({ uri: track.uri }), { method: 'POST' });
        }
      } catch (err) {
        console.error('[g2 surprise-me queue]', err);
      }
    });

    return c.json({ ok: true, track: { name: firstName, artists: firstArtists } });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── GET /playlists ───────────────────────────────────────────────────────────
// Lists the user's playlists (up to 20). Source: GET /me/playlists.
// Returns an array of {id, name, uri, trackCount}.
g2Router.get('/playlists', async (c) => {
  const userId = c.get('userId');
  if (!ensureSpotifyConnected(userId)) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }
  try {
    const res = await spotifyFetch(userId, '/me/playlists?limit=20', { method: 'GET' });
    if (!res.ok) {
      return c.json({ error: `spotify_${res.status}` }, 500);
    }
    const data = await res.json() as { items?: Array<any> };
    const playlists = (data.items ?? []).map((p: any) => ({
      id: p.id as string,
      name: (p.name ?? '') as string,
      uri: p.uri as string,
      trackCount: typeof p.tracks?.total === 'number' ? p.tracks.total : 0,
    }));
    return c.json({ playlists });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /play-context ───────────────────────────────────────────────────────
// Body: { contextUri: string }  e.g. "spotify:playlist:abc123" or
// "spotify:album:..." — anything Spotify accepts as context_uri.
g2Router.post('/play-context', async (c) => {
  const userId = c.get('userId');
  if (!ensureSpotifyConnected(userId)) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  let contextUri: string | undefined;
  try {
    const body = await c.req.json<{ contextUri?: string }>();
    contextUri = body?.contextUri;
  } catch {
    // no body / invalid JSON
  }
  if (!contextUri || typeof contextUri !== 'string') {
    return c.json({ error: 'missing_contextUri' }, 400);
  }

  try {
    const res = await spotifyFetch(userId, '/me/player/play', {
      method: 'PUT',
      body: JSON.stringify({ context_uri: contextUri }),
    });
    // 404 with "NO_ACTIVE_DEVICE" comes through here on a cold device.
    if (res.status === 404) {
      return c.json({ error: 'no_device' }, 503);
    }
    if (!res.ok && res.status !== 204) {
      return c.json({ error: `spotify_${res.status}` }, 500);
    }
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── GET /lyrics ─────────────────────────────────────────────────────────────
// Free, unauthenticated proxy to LRClib. Returns whatever the upstream gives us
// (plainLyrics + syncedLyrics, either may be null), or a 200 with both null
// when LRClib has no record. Surfaces 502 on network/5xx errors so the plugin
// can show a clean "lyrics unavailable" message.
g2Router.get('/lyrics', async (c) => {
  const trackName = c.req.query('trackName');
  const artistName = c.req.query('artistName');
  if (!trackName || !artistName) {
    return c.json({ error: 'missing_params' }, 400);
  }

  const url = 'https://lrclib.net/api/get?'
    + 'track_name=' + encodeURIComponent(trackName)
    + '&artist_name=' + encodeURIComponent(artistName);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'moodify-g2 (https://github.com/yann/moodify)' },
    });

    if (res.status === 404) {
      return c.json({ plainLyrics: null, syncedLyrics: null });
    }
    if (!res.ok) {
      return c.json({ error: 'lyrics_unavailable' }, 502);
    }

    const data = await res.json() as { plainLyrics?: string | null; syncedLyrics?: string | null };
    return c.json({
      plainLyrics: data.plainLyrics ?? null,
      syncedLyrics: data.syncedLyrics ?? null,
    });
  } catch {
    return c.json({ error: 'lyrics_unavailable' }, 502);
  }
});

// ── Trail relay (Allure) : boîte aux lettres RideState par tenant ──────────────
g2Router.post('/trail/ride', async (c) => {
  const userId = c.get('userId');
  let raw: string;
  try { raw = await c.req.text(); } catch { return c.json({ error: 'bad_body' }, 400); }
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed === 'null') { putRide(userId, null); return c.body(null, 204); }
  try { JSON.parse(trimmed); } catch { return c.json({ error: 'invalid_json' }, 400); }
  putRide(userId, trimmed);
  return c.body(null, 204);
});

g2Router.get('/trail/ride', (c) => {
  return c.json(getRide(c.get('userId')));
});

// ── Trail library (Allure) : parcours persistés par tenant ────────────────────
g2Router.get('/trail/library', (c) => {
  return c.json({ trails: listTrails(c.get('userId')) });
});

g2Router.post('/trail/library', async (c) => {
  let t: any;
  try { t = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }
  if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || !Array.isArray(t.points)
      || typeof t.totalDistanceM !== 'number' || typeof t.elevationGainM !== 'number' || typeof t.createdAt !== 'number') {
    return c.json({ error: 'invalid_trail' }, 400);
  }
  upsertTrail(c.get('userId'), t as Trail);
  return c.body(null, 204);
});

g2Router.delete('/trail/library/:id', (c) => {
  deleteTrailForUser(c.get('userId'), c.req.param('id'));
  return c.body(null, 204);
});
