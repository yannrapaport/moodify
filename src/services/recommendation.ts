import { getClient } from './spotify.js';
import {
  getFeedbackByRating,
  getAudioFeaturesForIds,
  getAllExclusions,
  getArtistGenres,
} from '../db/queries.js';
import type { TasteProfile } from '../types.js';
import type { Track } from '@spotify/web-api-ts-sdk';

// ── Mood keyword → audio feature delta map ────────────────────────────────────

interface FeatureDelta {
  energy?: number;
  valence?: number;
  danceability?: number;
  acousticness?: number;
  instrumentalness?: number;
}

const MOOD_MAP: Array<{ keywords: string[]; delta: FeatureDelta }> = [
  { keywords: ['chill', 'relax', 'calm', 'sleep'], delta: { energy: -0.25, valence: 0.1 } },
  { keywords: ['upbeat', 'energetic', 'pump', 'workout'], delta: { energy: 0.25, danceability: 0.1 } },
  { keywords: ['happy', 'feel good', 'positive'], delta: { valence: 0.25 } },
  { keywords: ['sad', 'melancholy', 'emotional'], delta: { valence: -0.2, energy: -0.1 } },
  { keywords: ['focus', 'concentrate', 'study'], delta: { instrumentalness: 0.3, energy: -0.1 } },
  { keywords: ['party', 'dance'], delta: { danceability: 0.25, energy: 0.15 } },
];

function clamp(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function applyMoodContext(profile: TasteProfile, context?: string): TasteProfile {
  if (!context) return profile;
  const lower = context.toLowerCase();
  const result = { ...profile };

  for (const { keywords, delta } of MOOD_MAP) {
    if (keywords.some((k) => lower.includes(k))) {
      if (delta.energy !== undefined) result.energy = clamp(result.energy + delta.energy);
      if (delta.valence !== undefined) result.valence = clamp(result.valence + delta.valence);
      if (delta.danceability !== undefined) result.danceability = clamp(result.danceability + delta.danceability);
      if (delta.acousticness !== undefined) result.acousticness = clamp(result.acousticness + delta.acousticness);
      if (delta.instrumentalness !== undefined) result.instrumentalness = clamp(result.instrumentalness + delta.instrumentalness);
    }
  }

  return result;
}

// ── Taste profile ─────────────────────────────────────────────────────────────

export function buildTasteProfile(): TasteProfile {
  const liked = getFeedbackByRating(1);
  const disliked = getFeedbackByRating(-1);

  const allIds = [...liked.map((f) => f.trackId), ...disliked.map((f) => f.trackId)];
  const featuresMap = new Map(getAudioFeaturesForIds(allIds).map((f) => [f.trackId, f]));

  const zero = { energy: 0, valence: 0, danceability: 0, acousticness: 0, instrumentalness: 0, tempo: 0 };
  let totalWeight = 0;
  const sum = { ...zero };

  for (const item of [...liked, ...disliked]) {
    const f = featuresMap.get(item.trackId);
    if (!f) continue;
    const w = item.rating; // +1 or -1
    sum.energy += f.energy * w;
    sum.valence += f.valence * w;
    sum.danceability += f.danceability * w;
    sum.acousticness += f.acousticness * w;
    sum.instrumentalness += f.instrumentalness * w;
    sum.tempo += (f.tempo / 220) * w; // normalize tempo
    totalWeight += Math.abs(w);
  }

  if (totalWeight === 0) {
    // Default profile — moderate energy, positive valence
    return { energy: 0.6, valence: 0.6, danceability: 0.6, acousticness: 0.2, instrumentalness: 0.1, tempo: 0.55, sampleSize: 0 };
  }

  return {
    energy: clamp(sum.energy / totalWeight),
    valence: clamp(sum.valence / totalWeight),
    danceability: clamp(sum.danceability / totalWeight),
    acousticness: clamp(sum.acousticness / totalWeight),
    instrumentalness: clamp(sum.instrumentalness / totalWeight),
    tempo: clamp(sum.tempo / totalWeight),
    sampleSize: totalWeight,
  };
}

// ── Recommendations ───────────────────────────────────────────────────────────

export async function getRecommendations(profile: TasteProfile, context?: string): Promise<Track[]> {
  const adjusted = applyMoodContext(profile, context);
  const client = await getClient();

  // Get seed tracks from liked feedback (top 5 most recent)
  const liked = getFeedbackByRating(1).slice(0, 5);
  let seedTracks: string[] = liked.map((f) => f.trackId);

  // Cold start: use user's top tracks (filtered by exclusions)
  if (seedTracks.length === 0) {
    const top = await client.currentUser.topItems('tracks', 'short_term', 10);
    const exclusions = getAllExclusions();
    const excludedArtists = new Set(exclusions.filter((e) => e.type === 'artist').map((e) => e.value));
    const excludedTracks = new Set(exclusions.filter((e) => e.type === 'track').map((e) => e.value));

    seedTracks = top.items
      .filter((t) => !excludedTracks.has(t.id) && !t.artists.some((a) => excludedArtists.has(a.id)))
      .slice(0, 5)
      .map((t) => t.id);
  }

  if (seedTracks.length === 0) return [];

  const recs = await client.recommendations.get({
    seed_tracks: seedTracks,
    limit: 20,
    target_energy: adjusted.energy,
    target_valence: adjusted.valence,
    target_danceability: adjusted.danceability,
    target_acousticness: adjusted.acousticness,
    target_instrumentalness: adjusted.instrumentalness,
    target_tempo: Math.round(adjusted.tempo * 220),
  });

  return recs.tracks;
}

// ── Exclusion filter ──────────────────────────────────────────────────────────

export async function filterExclusions(tracks: Track[]): Promise<Track[]> {
  const exclusions = getAllExclusions();
  const excludedArtists = new Set(exclusions.filter((e) => e.type === 'artist').map((e) => e.value));
  const excludedTracks = new Set(exclusions.filter((e) => e.type === 'track').map((e) => e.value));
  const excludedGenres = new Set(exclusions.filter((e) => e.type === 'genre').map((e) => e.value.toLowerCase()));

  return tracks.filter((track) => {
    if (excludedTracks.has(track.id)) return false;
    if (track.artists.some((a) => excludedArtists.has(a.id))) return false;

    // Genre filter uses cache only — no live API calls
    if (excludedGenres.size > 0) {
      for (const artist of track.artists) {
        const genres = getArtistGenres(artist.id);
        if (genres && genres.some((g) => excludedGenres.has(g.toLowerCase()))) return false;
      }
    }

    return true;
  });
}
