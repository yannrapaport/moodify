---
created: 2026-02-22T09:54:18.063Z
title: Make Moodify public with VPS deployment
area: general
files: []
---

## Problem

Moodify is working locally and MCP connection is verified with Claude Code, but it's only accessible on the local machine. The server needs to be deployed to a VPS so it's always-on and publicly accessible.

Known constraints from prior work:
- `MCP_API_KEY` + Claude Code HTTP transport: Claude Code MCP SDK doesn't send custom `Authorization` headers. For VPS, the recommended approach is either a reverse proxy (nginx/Caddy with API key enforcement at proxy level) or no API key behind a firewall with IP allowlist.
- `HOST` env var must be set to `0.0.0.0` in Docker (defaults to `127.0.0.1` for local).
- A `Dockerfile` already exists at the repo root.

## Solution

1. Provision a VPS (e.g. Hostinger — MCP tools available for this)
2. Set up Docker + docker-compose with the correct env vars
3. Configure reverse proxy (Caddy or nginx) for HTTPS + optional API key enforcement
4. Point a domain/subdomain at the VPS
5. Update Claude Code MCP config to use the public URL
6. Test end-to-end from remote Claude Code session
