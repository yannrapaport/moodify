import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../services/spotify.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

export function registerLibraryTools(server: McpServer): void {
  server.tool('save_track', 'Save a track to your Spotify library', {
    id: z.string().describe('Spotify track ID'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.currentUser.tracks.saveTracks([args.id as string]);
      return text(`Track ${args.id} saved to library.`);
    } catch (e) { return text(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.tool('remove_track', 'Remove a track from your Spotify library', {
    id: z.string().describe('Spotify track ID'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.currentUser.tracks.removeSavedTracks([args.id as string]);
      return text(`Track ${args.id} removed from library.`);
    } catch (e) { return text(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.tool('get_saved_tracks', 'Get your saved tracks', {
    limit: z.number().int().min(1).max(50).default(20),
    offset: z.number().int().min(0).default(0),
  }, async (args) => {
    try {
      const client = await getClient();
      // SDK expects a literal union of 0-50; Zod already constrains the value to [1,50]
      const res = await client.currentUser.tracks.savedTracks(args.limit as any, args.offset as number);
      if (res.items.length === 0) return text('No saved tracks found.');
      return text(res.items.map((item, i) =>
        `${(args.offset as number) + i + 1}. ${item.track.name} — ${item.track.artists.map((a) => a.name).join(', ')}`
      ).join('\n'));
    } catch (e) { return text(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.tool('check_saved_tracks', 'Check if tracks are in your library', {
    ids: z.array(z.string()).min(1).max(50).describe('Track IDs to check'),
  }, async (args) => {
    try {
      const client = await getClient();
      const results = await client.currentUser.tracks.hasSavedTracks(args.ids as string[]);
      return text((args.ids as string[]).map((id, i) => `${id}: ${results[i] ? '✓ saved' : '✗ not saved'}`).join('\n'));
    } catch (e) { return text(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.tool('save_album', 'Save an album to your library', {
    id: z.string().describe('Spotify album ID'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.currentUser.albums.saveAlbums([args.id as string]);
      return text(`Album ${args.id} saved to library.`);
    } catch (e) { return text(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.tool('remove_album', 'Remove an album from your library', {
    id: z.string().describe('Spotify album ID'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.currentUser.albums.removeSavedAlbums([args.id as string]);
      return text(`Album ${args.id} removed from library.`);
    } catch (e) { return text(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  });
}
