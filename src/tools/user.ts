import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../services/spotify.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

const timeRangeSchema = z.enum(['short_term', 'medium_term', 'long_term']).default('medium_term');

export function registerUserTools(server: McpServer): void {
  server.tool('get_top_tracks', 'Get your top Spotify tracks', {
    time_range: timeRangeSchema.describe('short_term (4 weeks), medium_term (6 months), long_term (all time)'),
    limit: z.number().int().min(1).max(50).default(20),
  }, async (args) => {
    try {
      const client = await getClient();
      // SDK expects a literal union of 0-50 for limit; Zod already constrains the value
      const res = await client.currentUser.topItems('tracks', args.time_range as any, args.limit as any);
      if (res.items.length === 0) return text('No top tracks found for this period.');
      return text(res.items.map((t: any, i: number) =>
        `${i + 1}. ${t.name} — ${t.artists.map((a: any) => a.name).join(', ')}`
      ).join('\n'));
    } catch (e) { return text(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  });

  server.tool('get_top_artists', 'Get your top Spotify artists', {
    time_range: timeRangeSchema.describe('short_term (4 weeks), medium_term (6 months), long_term (all time)'),
    limit: z.number().int().min(1).max(50).default(20),
  }, async (args) => {
    try {
      const client = await getClient();
      // SDK expects a literal union of 0-50 for limit; Zod already constrains the value
      const res = await client.currentUser.topItems('artists', args.time_range as any, args.limit as any);
      if (res.items.length === 0) return text('No top artists found for this period.');
      return text(res.items.map((a: any, i: number) =>
        `${i + 1}. ${a.name} — ${a.genres.slice(0, 3).join(', ')} (popularity: ${a.popularity})`
      ).join('\n'));
    } catch (e) { return text(`Error: ${e instanceof Error ? e.message : String(e)}`); }
  });
}
