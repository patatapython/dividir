const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();
let lastSweep = 0;

/**
 * Drops clients whose whole window has passed. Behind a trusted proxy every
 * visitor is a key, so without this the map would grow with every address ever
 * seen. Amortized: at most one sweep per window, on the next request, so memory
 * stays bounded by the clients of the last minute.
 */
function sweep(now: number) {
  if (now - lastSweep < WINDOW_MS) return;
  lastSweep = now;
  const windowStart = now - WINDOW_MS;
  for (const [key, times] of hits) {
    if ((times.at(-1) ?? 0) <= windowStart) hits.delete(key);
  }
}

/**
 * Generous in-memory IP limiter for the unauthenticated createGroup
 * endpoint (spec §6). Single-container deployment makes this sufficient.
 * There is no switch to turn it off: the E2E suite runs against the
 * production build and gives each test its own client address.
 */
export function allowRequest(key: string, now: number = Date.now()): boolean {
  sweep(now);
  const windowStart = now - WINDOW_MS;
  const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Bucket for requests whose client cannot be told apart. */
const SHARED_KEY = 'shared';

/**
 * Who a request comes from, for the limiter (T-07). X-Forwarded-For is only
 * believed when a trusted reverse proxy overwrites it (TRUST_PROXY=1, see
 * `trustsProxy`); the proxy appends the address it saw, so the last entry is
 * the one it vouches for and anything before it came from the client. Without
 * a trusted proxy every request shares one bucket: stricter, never spoofable.
 */
export function clientKey(forwardedFor: string | null, trustProxy: boolean): string {
  if (!trustProxy) return SHARED_KEY;
  const last = forwardedFor?.split(',').at(-1)?.trim();
  return last || SHARED_KEY;
}

/** Set only where a reverse proxy overwrites X-Forwarded-For (production, the E2E server). */
export function trustsProxy(): boolean {
  return process.env.TRUST_PROXY === '1';
}

export function resetRateLimit(): void {
  hits.clear();
  lastSweep = 0;
}

/** How many clients the limiter currently remembers (for tests). */
export function trackedClients(): number {
  return hits.size;
}
