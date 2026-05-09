import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { randomUUID } from 'crypto';
import { createMcpServer } from './mcp.js';
import { authRouter } from './auth/handler.js';
import { getTokens } from './db/queries.js';
import { apiKeyAuth } from './middleware/api-key.js';
import { g2Router } from './api/g2.js';

const ALLOWED_ORIGINS = new Set([
  'http://localhost',
  'https://claude.ai',
]);

if (process.env.ALLOWED_ORIGIN) {
  ALLOWED_ORIGINS.add(process.env.ALLOWED_ORIGIN);
}

// Per-session transports for stateful MCP connections
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
const servers = new Map<string, ReturnType<typeof createMcpServer>>();

const app = new Hono();

// CORS for the public probe routes (/health, /.well-known/*). The G2 plugin's
// in-WebView config form fetches /health to verify the URL points at a moodify
// before persisting credentials, so the route needs to respond to cross-origin
// preflights. /mcp/* keeps its own stricter origin check below.
const publicCors = cors({ origin: (origin) => origin });
app.use('/health', publicCors);
app.use('/.well-known/*', publicCors);

// MCP SDK OAuth discovery — return JSON 404 so the SDK doesn't crash parsing plain text
app.get('/.well-known/oauth-authorization-server', (c) => c.json({ error: 'not_supported' }, 404));
app.get('/.well-known/oauth-protected-resource', (c) => c.json({ error: 'not_supported' }, 404));

// Health check (no auth required)
app.get('/health', (c) => {
  const authenticated = getTokens() !== null;
  return c.json({ status: 'ok', authenticated });
});

// Auth routes (no API key required)
app.route('/auth', authRouter);

// G2 REST API for the Even Realities G2 plugin. The router applies its own
// apiKeyAuth() middleware internally, so we mount it before /mcp/*.
app.route('/api/g2', g2Router);

// Origin validation middleware for /mcp
app.use('/mcp/*', async (c, next) => {
  const origin = c.req.header('origin') ?? '';
  const originBase = origin.replace(/:\d+$/, '');
  const isAllowed = !origin || ALLOWED_ORIGINS.has(origin) || ALLOWED_ORIGINS.has(originBase) ||
    origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');

  if (!isAllowed) {
    return c.text('Forbidden: Origin not allowed', 403);
  }
  await next();
});

// API key middleware for /mcp (shared with /api/g2 via apiKeyAuth())
app.use('/mcp/*', apiKeyAuth());

// MCP Streamable HTTP transport
app.all('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');

  let transport: WebStandardStreamableHTTPServerTransport;
  let isNewSession = false;
  let server: ReturnType<typeof createMcpServer> | undefined;

  if (sessionId && transports.has(sessionId)) {
    transport = transports.get(sessionId)!;
  } else if (c.req.method === 'POST') {
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessionclosed: (sid) => {
        transports.delete(sid);
        servers.delete(sid);
      },
    });
    server = createMcpServer();
    try {
      await server.connect(transport);
    } catch (e) {
      return c.text(`Failed to initialize MCP session: ${e instanceof Error ? e.message : String(e)}`, 500);
    }
    isNewSession = true;
  } else {
    return c.text('No active session — POST to /mcp first to initialize', 400);
  }

  const resp = await transport.handleRequest(c.req.raw);

  // Session ID is only available after handleRequest processes the initialize request
  if (isNewSession && transport.sessionId) {
    transports.set(transport.sessionId, transport);
    servers.set(transport.sessionId, server!);
  }

  return resp;
});

export function startServer(port: number): void {
  const host = process.env.HOST ?? '127.0.0.1';
  serve({ fetch: app.fetch, port, hostname: host }, () => {
    console.log(`Moodify MCP server running on ${host}:${port}`);
  });
}
