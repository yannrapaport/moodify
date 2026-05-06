import type { MiddlewareHandler } from 'hono';

/**
 * Bearer-token API key middleware.
 *
 * Compares the `Authorization: Bearer ...` header to `MCP_API_KEY` from the
 * environment. If `MCP_API_KEY` is unset (e.g. local dev), the middleware
 * is a no-op — same behavior as the original inline check in server.ts.
 *
 * Reads the env var at call time (not import time) so tests can mutate it.
 */
export function apiKeyAuth(): MiddlewareHandler {
  return async (c, next) => {
    const expected = process.env.MCP_API_KEY;
    if (!expected) {
      await next();
      return;
    }
    const auth = c.req.header('authorization') ?? '';
    if (auth !== `Bearer ${expected}`) {
      return c.text('Unauthorized', 401);
    }
    await next();
  };
}
