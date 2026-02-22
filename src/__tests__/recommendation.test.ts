import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db/queries before importing recommendation service
vi.mock('../db/queries.js', () => ({
  getFeedbackByRating: vi.fn(),
  getAudioFeaturesForIds: vi.fn(),
  getAllExclusions: vi.fn(),
  getArtistGenres: vi.fn(),
}));

import { buildTasteProfile, filterExclusions } from '../services/recommendation.js';
import * as queries from '../db/queries.js';
import type { Feedback, AudioFeatures, Exclusion } from '../types.js';
import type { Track } from '@spotify/web-api-ts-sdk';

const getFeedbackByRating = vi.mocked(queries.getFeedbackByRating);
const getAudioFeaturesForIds = vi.mocked(queries.getAudioFeaturesForIds);
const getAllExclusions = vi.mocked(queries.getAllExclusions);
const getArtistGenres = vi.mocked(queries.getArtistGenres);

function makeFeedback(overrides: Partial<Feedback>): Feedback {
  return {
    trackId: 'track1',
    trackName: 'Test Track',
    artistName: 'Test Artist',
    artistId: 'artist1',
    rating: 1,
    comment: null,
    createdAt: 0,
    ...overrides,
  };
}

function makeAudioFeatures(trackId: string, overrides: Partial<AudioFeatures> = {}): AudioFeatures {
  return {
    trackId,
    energy: 0.5,
    valence: 0.5,
    danceability: 0.5,
    acousticness: 0.5,
    instrumentalness: 0.5,
    tempo: 120,
    ...overrides,
  };
}

function makeTrack(id: string, artistIds: string[]): Track {
  // Minimal stub — only fields accessed by filterExclusions are populated.
  // `as unknown as Track` is required because Track has many fields not relevant here.
  return {
    id,
    name: `Track ${id}`,
    uri: `spotify:track:${id}`,
    artists: artistIds.map((aid) => ({ id: aid, name: `Artist ${aid}` })),
  } as unknown as Track;
}

describe('buildTasteProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns default profile when no feedback exists', () => {
    getFeedbackByRating.mockReturnValue([]);
    getAudioFeaturesForIds.mockReturnValue([]);

    const profile = buildTasteProfile();
    expect(profile.sampleSize).toBe(0);
    expect(profile.energy).toBeGreaterThan(0);
  });

  it('computes weighted average correctly for liked tracks only', () => {
    const fb = makeFeedback({ trackId: 'a', rating: 1 });
    getFeedbackByRating.mockImplementation((rating) => (rating === 1 ? [fb] : []));
    getAudioFeaturesForIds.mockReturnValue([
      makeAudioFeatures('a', { energy: 0.8, valence: 0.9, danceability: 0.7, acousticness: 0.1, instrumentalness: 0.05, tempo: 140 }),
    ]);

    const profile = buildTasteProfile();
    expect(profile.energy).toBeCloseTo(0.8, 5);
    expect(profile.valence).toBeCloseTo(0.9, 5);
    expect(profile.danceability).toBeCloseTo(0.7, 5);
    expect(profile.sampleSize).toBe(1);
  });

  it('disliked tracks subtract from the profile via signed weighted average', () => {
    // Formula: sum(feature * rating) / sum(|rating|)
    // liked energy=0.8, weight=+1 → contributes +0.8
    // disliked energy=0.2, weight=-1 → contributes -0.2
    // result = (0.8 + (-0.2)) / (1 + 1) = 0.6 / 2 = 0.3
    const liked = makeFeedback({ trackId: 'a', rating: 1 });
    const disliked = makeFeedback({ trackId: 'b', rating: -1 });

    getFeedbackByRating.mockImplementation((rating) =>
      rating === 1 ? [liked] : [disliked],
    );
    getAudioFeaturesForIds.mockReturnValue([
      makeAudioFeatures('a', { energy: 0.8, valence: 0.8, danceability: 0.8, acousticness: 0.2, instrumentalness: 0.1, tempo: 140 }),
      makeAudioFeatures('b', { energy: 0.2, valence: 0.2, danceability: 0.2, acousticness: 0.8, instrumentalness: 0.9, tempo: 80 }),
    ]);

    const profile = buildTasteProfile();
    expect(profile.energy).toBeCloseTo(0.3, 5);
    expect(profile.sampleSize).toBe(2);
  });

  it('normalizes tempo to 0-1 range (divides by 220)', () => {
    getFeedbackByRating.mockImplementation((rating) =>
      rating === 1 ? [makeFeedback({ trackId: 'a', rating: 1 })] : [],
    );
    getAudioFeaturesForIds.mockReturnValue([
      makeAudioFeatures('a', { tempo: 110 }),
    ]);

    const profile = buildTasteProfile();
    // 110 / 220 = 0.5
    expect(profile.tempo).toBeCloseTo(0.5, 5);
  });

  it('clamps values to [0, 1]', () => {
    const liked = makeFeedback({ trackId: 'a', rating: 1 });
    const disliked = makeFeedback({ trackId: 'b', rating: -1 });
    getFeedbackByRating.mockImplementation((r) => (r === 1 ? [liked] : [disliked]));
    getAudioFeaturesForIds.mockReturnValue([
      // Both tracks have energy=0 for liked and energy=1 for disliked
      // Net: (0 * 1 + 1 * -1) / 2 = -0.5 → clamped to 0
      makeAudioFeatures('a', { energy: 0 }),
      makeAudioFeatures('b', { energy: 1 }),
    ]);

    const profile = buildTasteProfile();
    expect(profile.energy).toBeGreaterThanOrEqual(0);
    expect(profile.energy).toBeLessThanOrEqual(1);
  });
});

describe('filterExclusions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all tracks when no exclusions exist', async () => {
    getAllExclusions.mockReturnValue([]);
    const tracks = [makeTrack('t1', ['a1']), makeTrack('t2', ['a2'])];
    const result = await filterExclusions(tracks);
    expect(result).toHaveLength(2);
  });

  it('removes tracks matching a track exclusion', async () => {
    getAllExclusions.mockReturnValue([
      { type: 'track', value: 't1', label: 'Track 1' } as Exclusion,
    ]);
    const tracks = [makeTrack('t1', ['a1']), makeTrack('t2', ['a2'])];
    const result = await filterExclusions(tracks);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t2');
  });

  it('removes tracks by excluded artist', async () => {
    getAllExclusions.mockReturnValue([
      { type: 'artist', value: 'a1', label: 'Artist 1' } as Exclusion,
    ]);
    const tracks = [makeTrack('t1', ['a1']), makeTrack('t2', ['a2'])];
    const result = await filterExclusions(tracks);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t2');
  });

  it('removes tracks matching excluded genre via artist cache', async () => {
    getAllExclusions.mockReturnValue([
      { type: 'genre', value: "children's-music", label: "Children's Music" } as Exclusion,
    ]);
    getArtistGenres.mockImplementation((artistId) => {
      if (artistId === 'a1') return ["children's-music", 'pop'];
      return null;
    });

    const tracks = [makeTrack('t1', ['a1']), makeTrack('t2', ['a2'])];
    const result = await filterExclusions(tracks);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t2');
  });

  it('skips genre filter for artists not in cache (graceful degradation)', async () => {
    getAllExclusions.mockReturnValue([
      { type: 'genre', value: "children's-music", label: "Children's Music" } as Exclusion,
    ]);
    // Return null = not cached; track should NOT be filtered out
    getArtistGenres.mockReturnValue(null);

    const tracks = [makeTrack('t1', ['a1'])];
    const result = await filterExclusions(tracks);
    expect(result).toHaveLength(1);
  });

  it('handles multiple exclusion types simultaneously', async () => {
    getAllExclusions.mockReturnValue([
      { type: 'artist', value: 'a2', label: 'Artist 2' } as Exclusion,
      { type: 'track', value: 't3', label: 'Track 3' } as Exclusion,
    ]);
    getArtistGenres.mockReturnValue([]);

    const tracks = [
      makeTrack('t1', ['a1']),
      makeTrack('t2', ['a2']), // excluded by artist
      makeTrack('t3', ['a3']), // excluded by track
    ];
    const result = await filterExclusions(tracks);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('t1');
  });
});
