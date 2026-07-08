/**
 * Server-rendered HTML for the landing page and post-OAuth dashboard. All
 * content is inline (no static assets to ship) — the surface is intentionally
 * tiny so we don't grow a front-end build pipeline.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
  :root {
    color-scheme: dark;
    --bg: #0b0b0f;
    --fg: #f5f5f7;
    --muted: #8a8a93;
    --accent: #1db954;
    --card: #16161c;
    --border: #2a2a33;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  main {
    max-width: 560px;
    width: 100%;
  }
  h1 { font-size: 32px; margin: 0 0 8px; }
  h2 { font-size: 20px; margin: 24px 0 12px; }
  p { line-height: 1.55; color: var(--fg); }
  .muted { color: var(--muted); }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: 24px;
    margin: 16px 0;
  }
  .cta {
    display: inline-block;
    background: var(--accent);
    color: #04140a;
    font-weight: 600;
    padding: 12px 22px;
    border-radius: 999px;
    text-decoration: none;
    margin-top: 12px;
  }
  .cta:hover { filter: brightness(1.05); }
  code.key {
    display: block;
    background: #0b0b0f;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 14px;
    word-break: break-all;
    user-select: all;
    margin: 12px 0;
  }
  .warn {
    background: #2a1c0d;
    border: 1px solid #5a3a14;
    color: #f5c97c;
    padding: 12px 14px;
    border-radius: 8px;
    font-size: 14px;
  }
  button {
    background: transparent;
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 14px;
    cursor: pointer;
    margin-right: 8px;
  }
  button:hover { background: #1f1f27; }
  small.foot {
    display: block;
    color: var(--muted);
    margin-top: 32px;
    font-size: 12px;
  }
`;

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

export function landingPage(): string {
  return layout(
    'Moodify',
    `
    <h1>Moodify</h1>
    <p class="muted">Spotify control for your <a style="color:inherit" href="https://github.com/yannrapaport/spotify-g2">Even Realities G2 glasses</a> — plus a personal recommendation engine.</p>

    <div class="card">
      <h2>Get started</h2>
      <p>Connect your Spotify account, get an API key, paste it into the Moodify Remote plugin on your G2. That's it.</p>
      <a class="cta" href="/auth/login">Connect with Spotify</a>
    </div>

    <small class="foot">
      Moodify is open source — <a style="color:inherit" href="https://github.com/yannrapaport/moodify">github.com/yannrapaport/moodify</a>.
      Your Spotify tokens are stored only on this server and used solely to control playback on your behalf.
    </small>
    `,
  );
}

type DashboardState =
  | { kind: 'new-key'; displayName: string; apiKey: string }
  | { kind: 'welcome-back' }
  | { kind: 'expired' }
  | { kind: 'generic' };

export function dashboardPage(state: DashboardState): string {
  if (state.kind === 'new-key') {
    return layout(
      'Moodify — your API key',
      `
      <h1>Welcome, ${escapeHtml(state.displayName)}</h1>
      <p>Your Spotify account is connected. Here's your API key:</p>

      <div class="card">
        <code class="key">${escapeHtml(state.apiKey)}</code>
        <div class="warn">Save it now. We store only the hash — if you lose this key, you'll need to regenerate it (and update every device that uses it).</div>
      </div>

      <div class="card">
        <h2>Use it in Moodify Remote</h2>
        <p class="muted">In the plugin's first-launch form, paste this key in the API key field. The Moodify URL is already filled in.</p>
      </div>
      `,
    );
  }

  if (state.kind === 'welcome-back') {
    return layout(
      'Moodify — connected',
      `
      <h1>You're connected</h1>
      <p>Your Spotify account is linked to Moodify. Your existing API key still works — we didn't rotate it.</p>
      <p class="muted">Lost your key? You'll need to regenerate it from the plugin (we don't keep a copy on the server).</p>
      <a class="cta" href="/">Back home</a>
      `,
    );
  }

  if (state.kind === 'expired') {
    return layout(
      'Moodify — link expired',
      `
      <h1>Link expired</h1>
      <p>That one-shot dashboard link is gone — either it was already opened, or it's older than 5 minutes.</p>
      <p>Reconnect to start over:</p>
      <a class="cta" href="/auth/login">Connect with Spotify</a>
      `,
    );
  }

  return layout(
    'Moodify',
    `
    <h1>Moodify</h1>
    <p>Nothing to show here. Did you mean <a style="color:inherit" href="/">the home page</a>?</p>
    `,
  );
}
