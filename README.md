# Moodify

A Spotify MCP server with a personal recommendation engine. Control Spotify and discover music tailored to your evolving taste profile — all through Claude.

Also powers the **[Moodify Remote](https://github.com/yannrapaport/spotify-g2)** Even Realities G2 plugin (Spotify control from your smart glasses + R1 ring).

## Deploy in 5 minutes

### Option A — Railway (no VPS needed, free tier available)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template?template=https://github.com/yannrapaport/moodify)

1. Click the button → sign in to Railway → **Deploy**
2. Set environment variables in Railway dashboard:
   - `SPOTIFY_CLIENT_ID` — from [developer.spotify.com](https://developer.spotify.com/dashboard)
   - `SPOTIFY_REDIRECT_URI` — your Railway app URL + `/auth/callback` (e.g. `https://moodify-xxx.railway.app/auth/callback`)
   - `MCP_API_KEY` — run `openssl rand -hex 32` to generate one
3. Add the redirect URI to your Spotify app settings
4. Visit `https://your-app.railway.app/auth/login` to link your Spotify account
5. Done — use the URL and MCP_API_KEY in Moodify Remote

### Option B — Self-hosted VPS (full control)

```bash
git clone https://github.com/yannrapaport/moodify
cd moodify
./scripts/install.sh
```

The install script sets up Docker + Caddy with HTTPS automatically.

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

## Support

If Moodify is useful to you, you can support its development on [Patreon](https://www.patreon.com/yannrapaport). It covers the VPS that runs the demo instance and helps me keep building open-source tools in my spare time.

## License

[MIT](LICENSE) — © Yann Rapaport

