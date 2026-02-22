import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { randomUUID } from 'crypto';
import { createMcpServer } from './mcp.js';
import { authRouter } from './auth/handler.js';
import { getTokens } from './db/queries.js';

const ALLOWED_ORIGINS = new Set([
  'http://localhost',
  'https://claude.ai',
]);

if (process.env.ALLOWED_ORIGIN) {
  ALLOWED_ORIGINS.add(process.env.ALLOWED_ORIGIN);
}

const MCP_API_KEY = process.env.MCP_API_KEY;

// Per-session transports for stateful MCP connections
const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
const servers = new Map<string, ReturnType<typeof createMcpServer>>();

const app = new Hono();

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

// API key middleware for /mcp
app.use('/mcp/*', async (c, next) => {
  if (!MCP_API_KEY) {
    await next();
    return;
  }
  const auth = c.req.header('authorization') ?? '';
  if (auth !== `Bearer ${MCP_API_KEY}`) {
    return c.text('Unauthorized', 401);
  }
  await next();
});

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
