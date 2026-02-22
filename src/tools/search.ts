import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../services/spotify.js';

const searchArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});

export function registerSearchTools(server: McpServer): void {
  server.tool('search_tracks', 'Search for tracks on Spotify', searchArgs.shape, async (args) => {
    const { query, limit } = searchArgs.parse(args);
    const client = await getClient();
    const res = await client.search(query, ['track'], undefined, limit as any);
    const tracks = res.tracks?.items ?? [];
    if (tracks.length === 0) return text('No tracks found.');
    return text(tracks.map((t, i) =>
      `${i + 1}. ${t.name} — ${t.artists.map((a) => a.name).join(', ')} (${t.album.name})\n   URI: ${t.uri}`
    ).join('\n'));
  });

  server.tool('search_albums', 'Search for albums on Spotify', searchArgs.shape, async (args) => {
    const { query, limit } = searchArgs.parse(args);
    const client = await getClient();
    const res = await client.search(query, ['album'], undefined, limit as any);
    const albums = res.albums?.items ?? [];
    if (albums.length === 0) return text('No albums found.');
    return text(albums.map((a, i) =>
      `${i + 1}. ${a.name} — ${a.artists.map((ar) => ar.name).join(', ')} (${a.release_date?.slice(0, 4) ?? '?'})\n   URI: ${a.uri}`
    ).join('\n'));
  });

  server.tool('search_artists', 'Search for artists on Spotify', searchArgs.shape, async (args) => {
    const { query, limit } = searchArgs.parse(args);
    const client = await getClient();
    const res = await client.search(query, ['artist'], undefined, limit as any);
    const artists = res.artists?.items ?? [];
    if (artists.length === 0) return text('No artists found.');
    return text(artists.map((a, i) =>
      `${i + 1}. ${a.name} — ${a.genres.slice(0, 3).join(', ')}\n   URI: ${a.uri}`
    ).join('\n'));
  });

  server.tool('search_playlists', 'Search for playlists on Spotify', searchArgs.shape, async (args) => {
    const { query, limit } = searchArgs.parse(args);
    const client = await getClient();
    const res = await client.search(query, ['playlist'], undefined, limit as any);
    const playlists = res.playlists?.items ?? [];
    if (playlists.length === 0) return text('No playlists found.');
    return text(playlists.map((p, i) =>
      `${i + 1}. ${p?.name} — by ${(p as any)?.owner?.display_name ?? 'Unknown'} (${(p as any)?.tracks?.total ?? '?'} tracks)\n   URI: ${p?.uri}`
    ).join('\n'));
  });
}

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}
