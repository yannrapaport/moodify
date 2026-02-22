import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient } from '../services/spotify.js';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

export function registerPlayerTools(server: McpServer): void {
  server.tool('get_current_track', 'Get the currently playing track', {}, async () => {
    try {
      const client = await getClient();
      const state = await client.player.getCurrentlyPlayingTrack();
      if (!state || !state.item) return text('Nothing is currently playing.');

      const item = state.item as any;
      const progress = state.progress_ms ?? 0;
      const duration = item.duration_ms ?? 0;
      const pct = duration > 0 ? Math.round((progress / duration) * 100) : 0;

      return text([
        `▶ ${item.name} — ${item.artists?.map((a: any) => a.name).join(', ')}`,
        `  Album: ${item.album?.name}`,
        `  Progress: ${msToTime(progress)} / ${msToTime(duration)} (${pct}%)`,
        `  Shuffle: ${state.shuffle_state ? 'on' : 'off'} | Repeat: ${state.repeat_state}`,
      ].join('\n'));
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('get_devices', 'List available Spotify devices', {}, async () => {
    try {
      const client = await getClient();
      const { devices } = await client.player.getAvailableDevices();
      if (devices.length === 0) return text('No devices found. Open Spotify on any device.');
      return text(devices.map((d) =>
        `${d.is_active ? '▶' : '○'} ${d.name} (${d.type}) — ID: ${d.id}`
      ).join('\n'));
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  server.tool('transfer_playback', 'Transfer playback to a different device', {
    device_id: z.string().describe('Device ID from get_devices'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.player.transferPlayback([args.device_id as string], true);
      return text(`Playback transferred to device ${args.device_id}.`);
    } catch (e) {
      return text(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

function msToTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
