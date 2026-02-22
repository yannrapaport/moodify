---
created: 2026-02-22T10:38:30.895Z
title: Add play_artist and play_track tools for direct Spotify playback
area: api
files:
  - src/tools/surprise-me.ts
  - src/mcp.ts
  - src/services/spotify.ts
---

## Problem

Moodify currently only supports mood-based discovery via `surprise_me`. Users can't ask Claude to play a specific artist, track, or album — e.g. "play Johnny Cash in the living room". This is a basic expectation for a Spotify-connected assistant.

The Spotify Web API already supports playback control (`PUT /me/player/play`) and device targeting, but no MCP tool exposes this.

## Solution

Add new MCP tools for direct playback control:

### `play_artist`
- Input: artist name (string), optional device name/id
- Flow: search artist → get top tracks or artist radio → start playback on target device
- Uses `client.search()` + `client.player.startResumePlayback()`

### `play_track`
- Input: track name + optional artist (string), optional device name/id
- Flow: search track → start playback
- Uses `client.search()` + `client.player.startResumePlayback()`

### `play_album`
- Input: album name + optional artist, optional device name/id
- Flow: search album → start playback with album context URI

### `list_devices`
- Input: none
- Returns available Spotify Connect devices (needed to target "salon", "bureau", etc.)
- Uses `client.player.getAvailableDevices()`

### Shared concerns
- Device resolution: fuzzy-match device name from `list_devices` (e.g. "salon" → "Salon Speaker")
- Scopes already included: `user-modify-playback-state`, `user-read-playback-state`
- Follow existing thin-handler pattern: Zod parse → service → MCP response
