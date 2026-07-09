// In-memory relais du RideState par tenant (userId). Éphémère : re-POST ~1 Hz
// côté téléphone, donc un restart backend se rattrape au tick suivant.
interface Entry { data: string | null; hash: string; updatedAt: number }

const store = new Map<number, Entry>();

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

export function putRide(userId: number, body: string | null): void {
  if (body === null) { store.set(userId, { data: null, hash: '0', updatedAt: Date.now() }); return; }
  store.set(userId, { data: body, hash: hashStr(body), updatedAt: Date.now() });
}

export function getRide(userId: number): { data: string | null; hash: string } {
  const e = store.get(userId);
  return e ? { data: e.data, hash: e.hash } : { data: null, hash: '0' };
}

/** Test-only: reset the in-memory store between tests. */
export function _clearAllRides(): void { store.clear(); }
