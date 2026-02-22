import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient, spotifyFetch } from '../services/spotify.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

export function registerQueueTools(server: McpServer): void {
  server.tool('add_to_queue', 'Add a track to the Spotify queue', {
    uri: z.string().describe('Spotify track URI'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.player.addItemToPlaybackQueue(args.uri as string);
      return text(`Added to queue: ${args.uri}`);
    } catch (e) {
      return text(`Queue error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('get_queue', 'Get the current Spotify playback queue', {}, async () => {
    try {
      // SDK may not have this endpoint — use raw fetch
      const res = await spotifyFetch('/me/player/queue');
      if (!res.ok) return text(`Could not get queue: ${res.status}`);
      const data = await res.json() as any;

      const current = data.currently_playing;
      const queue: any[] = data.queue ?? [];

      const lines: string[] = [];
      if (current) {
        lines.push(`▶ Now playing: ${current.name} — ${current.artists?.[0]?.name ?? 'Unknown'}`);
      }
      if (queue.length === 0) {
        lines.push('Queue is empty.');
      } else {
        lines.push('\nUp next:');
        queue.slice(0, 20).forEach((t, i) => {
          lines.push(`${i + 1}. ${t.name} — ${t.artists?.[0]?.name ?? 'Unknown'}`);
        });
      }
      return text(lines.join('\n'));
    } catch (e) {
      return text(`Queue error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}
