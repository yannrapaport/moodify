---
created: 2026-02-22T09:54:18.063Z
title: Develop web interface with multi-user support and authentication
area: ui
files:
  - src/server.ts
  - src/auth/handler.ts
  - src/auth/token-store.ts
  - src/db/schema.sql
---

## Problem

Moodify currently works as a single-user MCP server (one Spotify account, OAuth tokens stored in a single-user DB). To make it publicly useful, it needs:
1. A lightweight web UI so users can authenticate with their own Spotify account without needing Claude Code
2. Multi-user support — each user has their own OAuth tokens, feedback history, exclusions, and taste profile
3. User-level authentication so one user can't access another's data

## Solution

### Multi-user DB changes
- Add `user_id` column to `tokens`, `feedback`, `audio_features_cache`, `exclusions` tables
- All queries parameterized by `user_id`

### Authentication layer
- Sign-up / login with email+password or magic link (or delegate to Spotify identity — user's Spotify ID becomes user_id)
- Session tokens (JWT or signed cookie) mapping web session → Spotify user_id
- MCP requests scoped to authenticated user

### Web UI
- Minimal: landing page, "Connect Spotify" button → existing PKCE OAuth flow
- Post-auth dashboard: taste profile display, exclusions management, feedback history
- Stack: lightweight (vanilla HTML/HTMX or minimal React), served by existing Hono server

### Approach options
- **Option A**: Use Spotify user ID as the sole identity (no separate auth — the Spotify OAuth IS the login). Simplest.
- **Option B**: Add separate user table with email/password. More complex, more flexible.

Recommend starting with Option A.
