import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../services/spotify.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

export function registerPlaylistTools(server: McpServer): void {
  server.tool('get_playlists', 'Get your Spotify playlists', {
    limit: z.number().int().min(1).max(50).default(20),
  }, async (args) => {
    try {
      const client = await getClient();
      // SDK expects a literal union of 0-50; Zod already constrains the value to [1,50]
      const res = await client.currentUser.playlists.playlists(args.limit as any);
      if (res.items.length === 0) return text('No playlists found.');
      return text(res.items.map((p, i) =>
        `${i + 1}. ${p.name} (${(p as any).tracks?.total ?? '?'} tracks) — ID: ${p.id}`
      ).join('\n'));
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('create_playlist', 'Create a new Spotify playlist', {
    name: z.string().min(1).describe('Playlist name'),
    description: z.string().optional().describe('Playlist description'),
    public: z.boolean().default(false).describe('Make playlist public'),
  }, async (args) => {
    try {
      const client = await getClient();
      const me = await client.currentUser.profile();
      const playlist = await client.playlists.createPlaylist(me.id, {
        name: args.name as string,
        description: (args.description as string | undefined) ?? '',
        public: args.public as boolean,
      });
      return text(`Created playlist "${playlist.name}"\nURL: ${playlist.external_urls.spotify}\nID: ${playlist.id}`);
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('add_tracks_to_playlist', 'Add tracks to a playlist', {
    playlist_id: z.string().describe('Playlist ID'),
    uris: z.array(z.string()).min(1).max(100).describe('Spotify track URIs'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.playlists.addItemsToPlaylist(args.playlist_id as string, args.uris as string[]);
      return text(`Added ${(args.uris as string[]).length} track(s) to playlist.`);
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('remove_tracks_from_playlist', 'Remove tracks from a playlist', {
    playlist_id: z.string().describe('Playlist ID'),
    uris: z.array(z.string()).min(1).max(100).describe('Spotify track URIs to remove'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.playlists.removeItemsFromPlaylist(
        args.playlist_id as string,
        { tracks: (args.uris as string[]).map((uri) => ({ uri })) },
      );
      return text(`Removed ${(args.uris as string[]).length} track(s) from playlist.`);
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('delete_playlist', 'Unfollow/delete a playlist', {
    playlist_id: z.string().describe('Playlist ID to delete'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.currentUser.playlists.unfollow(args.playlist_id as string);
      return text(`Playlist ${args.playlist_id} removed.`);
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}
