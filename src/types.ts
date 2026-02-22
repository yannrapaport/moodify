export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // unix timestamp in seconds
}

export interface Feedback {
  trackId: string;
  trackName: string;
  artistName: string;
  artistId: string;
  rating: 1 | -1;
  comment: string | null;
  createdAt: number;
}

export interface AudioFeatures {
  trackId: string;
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  tempo: number;
}

export interface ArtistGenres {
  artistId: string;
  genres: string[];
}

export interface TasteProfile {
  energy: number;
  valence: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  tempo: number; // normalized 0-1 (raw / 220)
  sampleSize: number;
}

export interface Exclusion {
  type: 'artist' | 'genre' | 'track';
  value: string;
  label: string;
}
