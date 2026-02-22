import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient, spotifyFetch } from '../services/spotify.js';
import { buildTasteProfile, getRecommendations, filterExclusions } from '../services/recommendation.js';
import { fetchBatchAudioFeatures } from '../services/audio-features.js';
import { getFeedbackByRating, getAllFeedback, getFeedbackCount, upsertFeedback, insertExclusion, deleteExclusion, getAllExclusions, upsertArtistGenres } from '../db/queries.js';
import type { Exclusion } from '../types.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

async function playUri(uri: string): Promise<void> {
  const body = uri.includes(':track:') ? { uris: [uri] } : { context_uri: uri };
  await spotifyFetch('/me/player/play', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function registerSurpriseMeTools(server: McpServer): void {
  server.tool('surprise_me', 'Play a track based on your taste profile and queue more in the background', {
    context: z.string().optional().describe('Optional mood context, e.g. "something chill" or "upbeat workout"'),
  }, async (args) => {
    try {
      const liked = getFeedbackByRating(1);
      const isColdStart = liked.length === 0;

      let firstTrackName = '';
      let firstTrackArtist = '';
      let firstUri = '';

      if (isColdStart) {
        // Cold start: pick from top tracks, filtered by exclusions
        const client = await getClient();
        const top = await client.currentUser.topItems('tracks', 'short_term', 10);
        const exclusions = getAllExclusions();
        const excludedArtists = new Set(exclusions.filter((e) => e.type === 'artist').map((e) => e.value));
        const excludedTracks = new Set(exclusions.filter((e) => e.type === 'track').map((e) => e.value));

        const candidate = top.items.find((t) =>
          !excludedTracks.has(t.id) && !t.artists.some((a) => excludedArtists.has(a.id))
        );

        if (!candidate) return text('No suitable tracks found. Try adding fewer exclusions or rating some tracks first.');

        firstUri = candidate.uri;
        firstTrackName = candidate.name;
        firstTrackArtist = candidate.artists[0]?.name ?? 'Unknown';
      } else {
        const top = liked[0];
        // Build a quick URI from track ID
        firstUri = `spotify:track:${top.trackId}`;
        firstTrackName = top.trackName;
        firstTrackArtist = top.artistName;
      }

      await playUri(firstUri);

      // Fire-and-forget: build and queue recommendations in background
      setImmediate(async () => {
        try {
          const profile = buildTasteProfile();
          const recs = await getRecommendations(profile, args.context as string | undefined);
          const filtered = await filterExclusions(recs);
          const toQueue = filtered.filter((t) => t.uri !== firstUri).slice(0, 7);

          for (const track of toQueue) {
            await spotifyFetch('/me/player/queue?' + new URLSearchParams({ uri: track.uri }), { method: 'POST' });
          }

          console.log(`[surprise_me] queued ${toQueue.length} tracks`);
        } catch (e) {
          console.error('[surprise_me queue]', e);
        }
      });

      const suffix = isColdStart
        ? "\n\nFirst time? I've picked from your recent top tracks. Rate what plays so I can learn your taste! 👍/👎"
        : '\n\nBuilding your queue in the background...';

      return text(`Now playing: ${firstTrackName} by ${firstTrackArtist}${suffix}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('Not authenticated')) return text('Not authenticated — visit /auth/login');
      if (msg.includes('404') || msg.includes('No active device')) {
        return text('No active Spotify device found. Open Spotify on your Mac or phone first.');
      }
      return text(`Surprise Me error: ${msg}`);
    }
  });

  server.tool('rate_track', 'Rate a track to train your taste profile', {
    track_id: z.string().describe('Spotify track ID'),
    track_name: z.string().describe('Track name'),
    artist_name: z.string().describe('Artist name'),
    artist_id: z.string().describe('Artist ID (for genre caching)'),
    // preprocess: MCP may send numbers as strings, coerce before literal check
    rating: z.preprocess((v) => typeof v === 'string' ? Number(v) : v, z.union([z.literal(1), z.literal(-1)])).describe('1 for thumbs up, -1 for thumbs down'),
    comment: z.string().optional().describe('Optional comment, e.g. "too energetic"'),
  }, async (args) => {
    try {
      upsertFeedback({
        trackId: args.track_id as string,
        trackName: args.track_name as string,
        artistName: args.artist_name as string,
        artistId: args.artist_id as string,
        rating: args.rating as 1 | -1,
        comment: (args.comment as string | undefined) ?? null,
        createdAt: Math.floor(Date.now() / 1000),
      });

      // Warm audio features cache
      fetchBatchAudioFeatures([args.track_id as string]).catch((e) => {
        console.error('[rate_track] audio features fetch failed:', e);
      });

      // Cache artist genres for future exclusion filtering
      const res = await spotifyFetch(`/artists/${args.artist_id}`);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.genres?.length > 0) {
          upsertArtistGenres(args.artist_id as string, data.genres);
        }
      }

      const emoji = args.rating === 1 ? '👍' : '👎';
      return text(`Saved! "${args.track_name}" rated ${emoji}`);
    } catch (e) {
      return text(`Error saving rating: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('add_exclusion', 'Add an artist, genre, or track to your exclusion list', {
    type: z.enum(['artist', 'genre', 'track']).describe('Type of exclusion'),
    value: z.string().describe('Artist ID, genre name, or track ID'),
    label: z.string().describe('Human-readable name for display'),
  }, async (args) => {
    try {
      insertExclusion(args as Exclusion);
      return text(`Added "${args.label}" to your ${args.type} exclusions.`);
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('remove_exclusion', 'Remove an item from your exclusion list', {
    type: z.string().describe('Type: artist, genre, or track'),
    value: z.string().describe('The value that was excluded'),
  }, async (args) => {
    try {
      deleteExclusion(args.type as string, args.value as string);
      return text(`Removed ${args.type} "${args.value}" from exclusions.`);
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('get_taste_profile', 'View your current taste profile and exclusions', {}, async () => {
    try {
      const profile = buildTasteProfile();
      const exclusions = getAllExclusions();

      const lines = [
        `🎵 Your Taste Profile (${profile.sampleSize} rated tracks)`,
        '',
        `Energy:           ${bar(profile.energy)} ${pct(profile.energy)}`,
        `Valence (mood):   ${bar(profile.valence)} ${pct(profile.valence)}`,
        `Danceability:     ${bar(profile.danceability)} ${pct(profile.danceability)}`,
        `Acousticness:     ${bar(profile.acousticness)} ${pct(profile.acousticness)}`,
        `Instrumentalness: ${bar(profile.instrumentalness)} ${pct(profile.instrumentalness)}`,
        `Tempo:            ~${Math.round(profile.tempo * 220)} BPM`,
      ];

      if (exclusions.length > 0) {
        lines.push('', '🚫 Exclusions:');
        for (const e of exclusions) {
          lines.push(`  [${e.type}] ${e.label} (${e.value})`);
        }
      } else {
        lines.push('', 'No exclusions set.');
      }

      return text(lines.join('\n'));
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('get_feedback_history', 'View your track rating history', {
    limit: z.number().int().min(1).max(100).default(20),
    // preprocess: MCP may send numbers as strings, coerce before literal check
    rating: z.preprocess((v) => v !== undefined && typeof v === 'string' ? Number(v) : v, z.union([z.literal(1), z.literal(-1)]).optional()).describe('Filter by rating: 1 (👍) or -1 (👎)'),
  }, async (args) => {
    try {
      const feedback = getAllFeedback(args.limit as number, args.rating as 1 | -1 | undefined);
      if (feedback.length === 0) return text('No feedback recorded yet.');

      return text(feedback.map((f) => {
        const emoji = f.rating === 1 ? '👍' : '👎';
        const date = new Date(f.createdAt * 1000).toLocaleDateString();
        const comment = f.comment ? ` — "${f.comment}"` : '';
        return `${emoji} ${f.trackName} — ${f.artistName} (${date})${comment}`;
      }).join('\n'));
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

function bar(v: number): string {
  const filled = Math.round(v * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
