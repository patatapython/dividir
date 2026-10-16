import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Production wiring behind the reverse proxy (Traefik). Read as text: the
// file is small and indented by Compose convention, and pulling in a YAML parser for
// three facts would be the larger risk.
const compose = readFileSync('compose.prod.yml', 'utf8');

/** The block of one service: its line up to the next line at the same or lower indentation. */
function service(name: string): string {
  const match = compose.match(new RegExp(`^  ${name}:\\n((?:    .*\\n|\\s*\\n)*)`, 'm'));
  if (!match) throw new Error(`no service ${name} in compose.prod.yml`);
  return match[1];
}

describe('compose.prod.yml', () => {
  // Verified on the production proxy: Traefik drops a client-sent X-Forwarded-For
  // and writes the real peer, so the last entry can be believed.
  it('lets the app believe the proxy for the rate limiter', () => {
    expect(service('dividir-app')).toMatch(/^\s+TRUST_PROXY: "1"$/m);
  });

  it('puts the app, and only the app, on the proxy network', () => {
    expect(service('dividir-app')).toMatch(/^\s+- proxy$/m);
    expect(service('dividir-db')).not.toMatch(/proxy/);
    expect(service('migrate')).not.toMatch(/proxy/);
    expect(compose).toMatch(/^  proxy:\n    name: coolify\n    external: true$/m);
  });
});
