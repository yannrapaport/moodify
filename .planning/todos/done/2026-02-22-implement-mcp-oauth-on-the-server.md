---
created: 2026-02-22T10:35:49.089Z
title: Implement MCP OAuth on the server
area: auth
files:
  - src/server.ts:40-63
  - src/auth/handler.ts
---

## Problem

claude.ai web remote MCP integration requires OAuth-based authentication (RFC 6749 / MCP OAuth discovery). Currently Moodify uses a simple `Authorization: Bearer <MCP_API_KEY>` header check, which works for Claude Code CLI (supports custom headers) but not for claude.ai web (expects OAuth flow via `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource`).

Currently those endpoints return JSON 404 — enough to prevent SDK crashes but not enough to enable actual OAuth.

## Solution

Implement MCP-spec OAuth server endpoints:

1. **`/.well-known/oauth-authorization-server`** — return OAuth metadata (authorization_endpoint, token_endpoint, etc.)
2. **`/.well-known/oauth-protected-resource`** — return resource metadata
3. **`/oauth/authorize`** — authorization endpoint (could be a simple approval page since this is a personal server)
4. **`/oauth/token`** — token endpoint (issue access tokens)

Approach options:
- **Simple**: Static token approach — pre-generate a token, the OAuth "flow" just validates and returns it. Minimal but enough for claude.ai.
- **Proper**: Full OAuth 2.0 with PKCE, token storage, refresh. More work but standard-compliant.

Recommend starting simple since this is a single-user personal server.
