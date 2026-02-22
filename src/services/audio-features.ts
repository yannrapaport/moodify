import { getClient, spotifyFetch } from './spotify.js';
import { getAudioFeatures, getAudioFeaturesForIds, upsertAudioFeatures } from '../db/queries.js';
import type { AudioFeatures } from '../types.js';

export async function fetchAudioFeatures(trackId: string): Promise<AudioFeatures | null> {
  const cached = getAudioFeatures(trackId);
  if (cached) return cached;

  const client = await getClient();
  const data = await client.tracks.audioFeatures(trackId);
  if (!data) return null;

  const features: AudioFeatures = {
    trackId,
    energy: data.energy,
    valence: data.valence,
    danceability: data.danceability,
    acousticness: data.acousticness,
    instrumentalness: data.instrumentalness,
    tempo: data.tempo,
  };

  upsertAudioFeatures(features);
  return features;
}

export async function fetchBatchAudioFeatures(ids: string[]): Promise<AudioFeatures[]> {
  if (ids.length === 0) return [];

  // Check cache first
  const cached = getAudioFeaturesForIds(ids);
  const cachedIds = new Set(cached.map((f) => f.trackId));
  const missing = ids.filter((id) => !cachedIds.has(id));

  if (missing.length === 0) return cached;

  const results: AudioFeatures[] = [...cached];

  // Spotify allows up to 100 IDs per batch request.
  // Use spotifyFetch directly: the SDK's audioFeatures() overloads resolve to `never`
  // for tuple inputs, making the return type unusable. Raw fetch gives explicit typing.
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const res = await spotifyFetch(`/audio-features?ids=${batch.join(',')}`);
    if (!res.ok) continue;

    const data = await res.json() as {
      audio_features: Array<{
        id: string;
        energy: number;
        valence: number;
        danceability: number;
        acousticness: number;
        instrumentalness: number;
        tempo: number;
      } | null>;
    };

    for (const item of data.audio_features ?? []) {
      if (!item) continue;
      const features: AudioFeatures = {
        trackId: item.id,
        energy: item.energy,
        valence: item.valence,
        danceability: item.danceability,
        acousticness: item.acousticness,
        instrumentalness: item.instrumentalness,
        tempo: item.tempo,
      };
      upsertAudioFeatures(features);
      results.push(features);
    }
  }

  return results;
}
