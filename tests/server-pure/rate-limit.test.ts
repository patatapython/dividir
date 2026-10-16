import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowRequest, clientKey, resetRateLimit, trackedClients } from '../../src/server/rate-limit';

function exhaust(key: string, t0: number) {
  for (let i = 0; i < 10; i++) allowRequest(key, t0 + i);
}

describe('rate limit', () => {
  beforeEach(resetRateLimit);
  afterEach(() => vi.unstubAllEnvs());

  it('allows 10 requests per key per minute, blocks the 11th', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) expect(allowRequest('ip1', t0 + i)).toBe(true);
    expect(allowRequest('ip1', t0 + 11)).toBe(false);
    expect(allowRequest('ip2', t0 + 11)).toBe(true);
  });

  it('frees the window after 60 seconds', () => {
    const t0 = 1_000_000;
    exhaust('ip1', t0);
    expect(allowRequest('ip1', t0 + 60_001)).toBe(true);
  });

  // With TRUST_PROXY=1 every visitor is a key; keys must not outlive their window
  // (session 10 backlog), or memory grows with every address ever seen.
  it('forgets clients whose window has passed', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 1000; i++) allowRequest(`visitor-${i}`, t0);
    expect(trackedClients()).toBe(1000);
    allowRequest('later', t0 + 60_001);
    expect(trackedClients()).toBe(1);
  });

  it('keeps a client that is still inside its window', () => {
    const t0 = 1_000_000;
    exhaust('busy', t0);
    allowRequest('other', t0 + 30_000);
    expect(allowRequest('busy', t0 + 30_001)).toBe(false);
  });

  // No environment switches the limiter off: the E2E suite runs against the production
  // build behind a trusted proxy and gives each test its own client address instead.
  it('has no bypass flag, in development or in production', () => {
    for (const env of ['development', 'production']) {
      resetRateLimit();
      vi.stubEnv('NODE_ENV', env);
      vi.stubEnv('RATE_LIMIT_DISABLED', '1');
      exhaust('ip1', 1_000_000);
      expect(allowRequest('ip1', 1_000_011)).toBe(false);
    }
  });
});

describe('client key', () => {
  // Without a proxy that overwrites it, X-Forwarded-For is whatever the client sent:
  // trusting it would let anyone mint a fresh bucket per request.
  it('ignores X-Forwarded-For unless a trusted proxy sets it', () => {
    expect(clientKey('203.0.113.7', false)).toBe(clientKey('198.51.100.9', false));
    expect(clientKey(null, false)).toBe(clientKey('203.0.113.7', false));
  });

  // The trusted proxy appends the address it saw; anything before it came from the client.
  it('takes the last entry the trusted proxy wrote', () => {
    expect(clientKey('203.0.113.7', true)).toBe('203.0.113.7');
    expect(clientKey('10.0.0.1, 203.0.113.7', true)).toBe('203.0.113.7');
    expect(clientKey(' 10.0.0.1 ,203.0.113.7 ', true)).toBe('203.0.113.7');
  });

  it('shares one bucket when a trusted proxy sent no address', () => {
    expect(clientKey(null, true)).toBe(clientKey('', true));
    expect(clientKey(null, true)).not.toBe('203.0.113.7');
  });
});
