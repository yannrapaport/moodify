# Moodify

A Spotify MCP server with a personal recommendation engine. Control Spotify and discover music tailored to your evolving taste profile — all through Claude.

## Features

- **Surprise Me** — plays a track based on your taste profile and queues more in the background
- **Taste profile** — learns from thumbs-up/down ratings using audio features (energy, valence, danceability, acousticness, tempo)
- **Mood context** — adjust recommendations with natural language ("something chill", "upbeat workout")
- **Exclusions** — block artists, genres, or tracks from recommendations
- **Full Spotify control** — playback, queue, search, playlists, library
- **OAuth PKCE** — no client secret required, intentionally secret-free

## Architecture

- TypeScript / Node.js 20, Hono HTTP framework
- MCP transport: `WebStandardStreamableHTTPServerTransport`
- Spotify SDK: `@spotify/web-api-ts-sdk`
- DB: `better-sqlite3` (5 tables: tokens, feedback, audio features cache, artist genres cache, exclusions)

## Setup

**1. Create a Spotify app** at [developer.spotify.com](https://developer.spotify.com/dashboard) with redirect URI `http://localhost:3000/auth/callback`.

**2. Configure environment:**
```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_REDIRECT_URI=http://localhost:3000/auth/callback
PORT=3000
```

**3. Run:**
```bash
npm install
npm run dev
```

**4. Authenticate:** visit `http://localhost:3000/auth/login` in your browser.

**5. Connect Claude Code:**
```json
{
  "mcpServers": {
    "moodify": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Docker

```bash
docker compose up -d
```

## Development

```bash
npm test        # run 22 unit tests
npm run build   # compile TypeScript
```
