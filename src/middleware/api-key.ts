import type { MiddlewareHandler } from 'hono';
import { getUserByApiKey, getUserById } from '../db/queries.js';

/**
 * Multi-tenant API key middleware for /api/g2/*.
 *
 * Reads `Authorization: Bearer <user-api-key>`, looks up the user by hash, and
 * sets `c.var.userId`. Returns 401 if the key doesn't match a user.
 */
export function userApiKeyAuth(): MiddlewareHandler<{ Variables: { userId: number } }> {
  return async (c, next) => {
    const auth = c.req.header('authorization') ?? '';
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match) return c.text('Unauthorized', 401);

    const user = getUserByApiKey(match[1]);
    if (!user) return c.text('Unauthorized', 401);

    c.set('userId', user.id);
    await next();
  };
}

/**
 * Single-tenant admin middleware for /mcp/*.
 *
 * The MCP server is the project owner's personal Claude integration — it runs
 * with `MCP_API_KEY` and operates against user 1's data. If `MCP_API_KEY` is
 * unset (local dev), the middleware is a no-op and still sets userId=1.
 */
export function adminApiKeyAuth(): MiddlewareHandler<{ Variables: { userId: number } }> {
  return async (c, next) => {
    const expected = process.env.MCP_API_KEY;

    if (expected) {
      const auth = c.req.header('authorization') ?? '';
      if (auth !== `Bearer ${expected}`) {
        return c.text('Unauthorized', 401);
      }
    }

    // The MCP server always operates against user 1. If that user doesn't exist
    // yet (fresh install), reject — the operator needs to /auth/login first.
    const adminUser = getUserById(1);
    if (!adminUser) {
      return c.text(
        'Admin user not found — visit /auth/login on the server first to set up the Spotify account backing the MCP integration.',
        503,
      );
    }
    c.set('userId', adminUser.id);
    await next();
  };
}
