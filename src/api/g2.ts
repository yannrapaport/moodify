import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { apiKeyAuth } from '../middleware/api-key.js';
import { getTokens } from '../db/queries.js';
import { getClient, spotifyFetch } from '../services/spotify.js';
import { buildTasteProfile, getRecommendations, filterExclusions } from '../services/recommendation.js';
import { getFeedbackByRating, getAllExclusions } from '../db/queries.js';

/**
 * REST sub-router for the Even Realities G2 plugin.
 *
 * Mounted at /api/g2 on the main Hono app. Reuses the existing Spotify
 * service layer (token storage, refresh logic, recommendation engine) —
 * no duplication of the OAuth flow or HTTP plumbing.
 *
 * Auth: Bearer ${MCP_API_KEY} (same scheme as /mcp/*).
 */
export const g2Router = new Hono();

g2Router.use('*', cors({
  origin: (origin) => origin,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
  maxAge: 600,
}));
g2Router.use('*', apiKeyAuth());

// Helper: short-circuit if Spotify is not connected (no tokens stored).
function ensureSpotifyConnected(): { connected: false } | { connected: true } {
  return getTokens() === null ? { connected: false } : { connected: true };
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
  if (!ensureSpotifyConnected().connected) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    const client = await getClient();
    const state = await client.player.getCurrentlyPlayingTrack();

    // No active playback context, or no track in the slot
    if (!state || !state.item) {
      return c.json({ isPlaying: false, track: null });
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

    return c.json({
      isPlaying: !!state.is_playing,
      track: {
        id: item.id ?? '',
        name: item.name ?? '',
        artists: (item.artists ?? []).map((a: any) => a.name),
        albumName: item.album?.name ?? '',
        isLiked,
      },
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /play-pause ─────────────────────────────────────────────────────────
g2Router.post('/play-pause', async (c) => {
  if (!ensureSpotifyConnected().connected) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    const client = await getClient();
    const state = await client.player.getPlaybackState();
    const currentlyPlaying = !!state?.is_playing;

    // Use raw fetch — the SDK chokes parsing Spotify's 204/empty-body responses
    // for player control endpoints.
    if (currentlyPlaying) {
      await spotifyFetch('/me/player/pause', { method: 'PUT' });
      return c.json({ isPlaying: false });
    }
    await spotifyFetch('/me/player/play', { method: 'PUT' });
    return c.json({ isPlaying: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /next ───────────────────────────────────────────────────────────────
g2Router.post('/next', async (c) => {
  if (!ensureSpotifyConnected().connected) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    await spotifyFetch('/me/player/next', { method: 'POST' });
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /prev ───────────────────────────────────────────────────────────────
g2Router.post('/prev', async (c) => {
  if (!ensureSpotifyConnected().connected) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    await spotifyFetch('/me/player/previous', { method: 'POST' });
    return c.json({ ok: true });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /like ───────────────────────────────────────────────────────────────
g2Router.post('/like', async (c) => {
  if (!ensureSpotifyConnected().connected) {
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

    const client = await getClient();

    if (!trackId) {
      const state = await client.player.getCurrentlyPlayingTrack();
      const item = state?.item as any;
      if (!item?.id) {
        return c.json({ error: 'no_current_track' }, 500);
      }
      trackId = item.id as string;
    }

    // Raw fetch — SDK saveTracks chokes on Spotify's empty 200 response.
    await spotifyFetch(`/me/tracks?ids=${encodeURIComponent(trackId)}`, { method: 'PUT' });
    return c.json({ ok: true, trackId });
  } catch (e) {
    return errorResponse(c, e);
  }
});

// ── POST /surprise-me ────────────────────────────────────────────────────────
// REST equivalent of the MCP `surprise_me` tool. Picks a track via the existing
// recommendation engine, starts playback, and queues 7 more in the background.
g2Router.post('/surprise-me', async (c) => {
  if (!ensureSpotifyConnected().connected) {
    return c.json({ error: 'spotify_not_connected' }, 503);
  }

  try {
    let context: string | undefined;
    try {
      const body = await c.req.json<{ context?: string }>();
      context = body?.context;
    } catch { /* no body — fine */ }

    const liked = getFeedbackByRating(1);
    const isColdStart = liked.length === 0;

    let firstUri = '';
    let firstName = '';
    let firstArtists: string[] = [];

    if (isColdStart) {
      // Pick from user's top tracks, filtered by exclusions.
      const client = await getClient();
      const top = await client.currentUser.topItems('tracks', 'short_term', 10);
      const exclusions = getAllExclusions();
      const excludedArtists = new Set(exclusions.filter((e) => e.type === 'artist').map((e) => e.value));
      const excludedTracks = new Set(exclusions.filter((e) => e.type === 'track').map((e) => e.value));

      const candidate = top.items.find((t) =>
        !excludedTracks.has(t.id) && !t.artists.some((a) => excludedArtists.has(a.id)),
      );
      if (!candidate) {
        return c.json({ error: 'no_suitable_tracks' }, 500);
      }
      firstUri = candidate.uri;
      firstName = candidate.name;
      firstArtists = candidate.artists.map((a) => a.name);
    } else {
      const top = liked[0];
      firstUri = `spotify:track:${top.trackId}`;
      firstName = top.trackName;
      firstArtists = [top.artistName];
    }

    // Start playback (track URI → uris payload, otherwise context_uri)
    const playBody = firstUri.includes(':track:') ? { uris: [firstUri] } : { context_uri: firstUri };
    await spotifyFetch('/me/player/play', {
      method: 'PUT',
      body: JSON.stringify(playBody),
    });

    // Fire-and-forget queue building. Mirrors the MCP tool behavior.
    setImmediate(async () => {
      try {
        const profile = buildTasteProfile();
        const recs = await getRecommendations(profile, context);
        const filtered = await filterExclusions(recs);
        const toQueue = filtered.filter((t) => t.uri !== firstUri).slice(0, 7);
        for (const track of toQueue) {
          await spotifyFetch('/me/player/queue?' + new URLSearchParams({ uri: track.uri }), { method: 'POST' });
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
