import { spawn } from 'node:child_process';

const MAX_DEG = 0.5; // aire max par côté

export function parseBbox(q: string | undefined): [number, number, number, number] {
  if (!q) throw new Error('bad_bbox');
  const parts = q.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) throw new Error('bad_bbox');
  const [w, s, e, n] = parts as [number, number, number, number];
  if (w >= e || s >= n) throw new Error('bad_bbox');
  if (w < -180 || e > 180 || s < -90 || n > 90) throw new Error('bad_bbox');
  if (e - w > MAX_DEG || n - s > MAX_DEG) throw new Error('bbox_too_large');
  return [w, s, e, n];
}

/** Essaie une liste de dates 'YYYYMMDD' et renvoie la 1re URL planet qui répond 206. */
export async function resolvePlanetUrl(dates: string[]): Promise<string> {
  for (const d of dates) {
    const url = `https://build.protomaps.com/${d}.pmtiles`;
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-0' } });
      if (r.status === 206 || r.status === 200) return url;
    } catch { /* essaie la suivante */ }
  }
  throw new Error('planet_unreachable');
}

/** Liste de dates candidates J, J-1, J-2 (UTC), format YYYYMMDD. */
export function candidateDates(now: Date): string[] {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}

export function extractBbox(planetUrl: string, bbox: [number, number, number, number], outPath: string): Promise<void> {
  const [w, s, e, n] = bbox;
  return new Promise((resolve, reject) => {
    const p = spawn('pmtiles', ['extract', planetUrl, outPath, `--bbox=${w},${s},${e},${n}`], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('extract_failed_' + code))));
  });
}
