import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getClient, spotifyFetch } from '../services/spotify.js';

const NO_DEVICE_MSG = 'No active Spotify device found. Open Spotify on your Mac or phone first.';

function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }] };
}

function handlePlaybackError(e: unknown): ReturnType<typeof text> {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('404') || msg.toLowerCase().includes('no active device') || msg.includes('Player command failed')) {
    return text(NO_DEVICE_MSG);
  }
  return text(`Playback error: ${msg}`);
}

async function getCurrentTrackInfo(): Promise<string> {
  // PUT /me/player/play returns 204 — must call GET /me/player to get track info
  const res = await spotifyFetch('/me/player');
  if (!res.ok || res.status === 204) {
    // Retry once after 500ms (device may need a moment to register)
    await new Promise((r) => setTimeout(r, 500));
    const retry = await spotifyFetch('/me/player');
    if (!retry.ok || retry.status === 204) return 'Playback started.';
    const data = await retry.json() as any;
    const item = data?.item;
    return item ? `Now playing: ${item.name} by ${item.artists?.[0]?.name ?? 'Unknown'}` : 'Playback started.';
  }
  const data = await res.json() as any;
  const item = data?.item;
  return item ? `Now playing: ${item.name} by ${item.artists?.[0]?.name ?? 'Unknown'}` : 'Playback started.';
}

export function registerPlaybackTools(server: McpServer): void {
  server.tool('play', 'Start or resume Spotify playback', {
    uri: z.string().optional().describe('Spotify URI to play (track, album, playlist)'),
    device_id: z.string().optional().describe('Target device ID (from get_devices)'),
  }, async (args) => {
    try {
      const body: Record<string, any> = {};
      if (args.uri) {
        const uri = args.uri as string;
        if (uri.includes(':track:')) body.uris = [uri];
        else body.context_uri = uri;
      }
      const qs = args.device_id ? `?device_id=${args.device_id}` : '';
      const res = await spotifyFetch(`/me/player/play${qs}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!res.ok && res.status !== 204) {
        const errText = await res.text();
        if (res.status === 404 || res.status === 403) return text(NO_DEVICE_MSG);
        return text(`Playback error: ${errText}`);
      }
      const info = await getCurrentTrackInfo();
      return text(info);
    } catch (e) {
      return handlePlaybackError(e);
    }
  });

  server.tool('pause', 'Pause Spotify playback', {}, async () => {
    try {
      const client = await getClient();
      await client.player.pausePlayback('');
      return text('Paused.');
    } catch (e) { return handlePlaybackError(e); }
  });

  server.tool('skip_next', 'Skip to next track', {}, async () => {
    try {
      const client = await getClient();
      await client.player.skipToNext('');
      return text('Skipped to next track.');
    } catch (e) { return handlePlaybackError(e); }
  });

  server.tool('skip_previous', 'Skip to previous track', {}, async () => {
    try {
      const client = await getClient();
      await client.player.skipToPrevious('');
      return text('Skipped to previous track.');
    } catch (e) { return handlePlaybackError(e); }
  });

  server.tool('seek', 'Seek to position in current track', {
    position_ms: z.number().int().min(0).describe('Position in milliseconds'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.player.seekToPosition(args.position_ms as number);
      return text(`Seeked to ${Math.round((args.position_ms as number) / 1000)}s.`);
    } catch (e) { return handlePlaybackError(e); }
  });

  server.tool('set_volume', 'Set playback volume', {
    volume_percent: z.number().int().min(0).max(100).describe('Volume 0-100'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.player.setPlaybackVolume(args.volume_percent as number);
      return text(`Volume set to ${args.volume_percent}%.`);
    } catch (e) { return handlePlaybackError(e); }
  });

  server.tool('toggle_shuffle', 'Toggle shuffle mode', {
    state: z.boolean().describe('true to enable shuffle, false to disable'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.player.togglePlaybackShuffle(args.state as boolean);
      return text(`Shuffle ${args.state ? 'enabled' : 'disabled'}.`);
    } catch (e) { return handlePlaybackError(e); }
  });

  server.tool('set_repeat', 'Set repeat mode', {
    state: z.enum(['off', 'track', 'context']).describe('off, track, or context'),
  }, async (args) => {
    try {
      const client = await getClient();
      await client.player.setRepeatMode(args.state as any);
      return text(`Repeat set to: ${args.state}.`);
    } catch (e) { return handlePlaybackError(e); }
  });
}
