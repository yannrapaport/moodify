/**
 * MCP tools all run as the "admin" user (user 1). This shim wraps the
 * multi-tenant service/query layer so individual tool files don't need to
 * thread userId through every call.
 *
 * Tools import from this file instead of '../services/spotify.js' /
 * '../db/queries.js' / '../services/recommendation.js' directly.
 */

import * as spotifyService from '../services/spotify.js';
import * as recService from '../services/recommendation.js';
import * as audioFeaturesService from '../services/audio-features.js';
import * as queries from '../db/queries.js';
import type { Track } from '@spotify/web-api-ts-sdk';
import type { TasteProfile, Feedback, Exclusion, AudioFeatures } from '../types.js';

export const ADMIN_USER_ID = 1;

// ── Spotify service ──────────────────────────────────────────────────────────

export const getClient = () => spotifyService.getClient(ADMIN_USER_ID);

export const spotifyFetch = (path: string, init?: RequestInit) =>
  spotifyService.spotifyFetch(ADMIN_USER_ID, path, init);

// ── Recommendation service ───────────────────────────────────────────────────

export const buildTasteProfile = (): TasteProfile => recService.buildTasteProfile(ADMIN_USER_ID);

export const getRecommendations = (profile: TasteProfile, context?: string): Promise<Track[]> =>
  recService.getRecommendations(ADMIN_USER_ID, profile, context);

export const filterExclusions = (tracks: Track[]): Promise<Track[]> =>
  recService.filterExclusions(ADMIN_USER_ID, tracks);

// ── Audio features service ───────────────────────────────────────────────────

export const fetchAudioFeatures = (trackId: string) =>
  audioFeaturesService.fetchAudioFeatures(ADMIN_USER_ID, trackId);

export const fetchBatchAudioFeatures = (ids: string[]) =>
  audioFeaturesService.fetchBatchAudioFeatures(ADMIN_USER_ID, ids);

// ── DB queries (per-user, scoped to admin) ───────────────────────────────────

export const getFeedbackByRating = (rating: 1 | -1) =>
  queries.getFeedbackByRating(ADMIN_USER_ID, rating);

export const getAllFeedback = (limit?: number, ratingFilter?: 1 | -1) =>
  queries.getAllFeedback(ADMIN_USER_ID, limit, ratingFilter);

export const getFeedbackCount = () => queries.getFeedbackCount(ADMIN_USER_ID);

export const upsertFeedback = (feedback: Feedback) =>
  queries.upsertFeedback(ADMIN_USER_ID, feedback);

export const insertExclusion = (exclusion: Exclusion) =>
  queries.insertExclusion(ADMIN_USER_ID, exclusion);

export const deleteExclusion = (type: string, value: string) =>
  queries.deleteExclusion(ADMIN_USER_ID, type, value);

export const getAllExclusions = () => queries.getAllExclusions(ADMIN_USER_ID);

// ── DB queries (global, no user scope) ───────────────────────────────────────

export const upsertAudioFeatures = (features: AudioFeatures) =>
  queries.upsertAudioFeatures(features);

export const getAudioFeatures = (trackId: string) => queries.getAudioFeatures(trackId);

export const getAudioFeaturesForIds = (ids: string[]) => queries.getAudioFeaturesForIds(ids);

export const upsertArtistGenres = (artistId: string, genres: string[]) =>
  queries.upsertArtistGenres(artistId, genres);

export const getArtistGenres = (artistId: string) => queries.getArtistGenres(artistId);
