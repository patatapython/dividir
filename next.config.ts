import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // The E2E server builds into its own dir so it can run beside `next dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // next dev (16.3+) otherwise writes an agent-rules block into the repository's
  // agent instruction files on every start.
  agentRules: false,
  // No `X-Powered-By: Next.js`: naming the framework only helps pick an exploit.
  poweredByHeader: false,
  async headers() {
    return [
      {
        // §2.1: the URL is the credential — never leak it via Referer, and
        // never let a foreign page frame the app (clickjacking). CSP
        // frame-ancestors is the standard; X-Frame-Options covers old browsers.
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
        ],
      },
      {
        source: '/g/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
    ];
  },
};

export default nextConfig;
