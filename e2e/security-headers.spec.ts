import { expect } from '@playwright/test';
import { test } from './support';

// Spec §2.1: the URL is the credential. These headers keep it out of
// Referer, out of search indexes, and the app out of foreign frames.
test('security headers on the landing and on a group URL', async ({ request }) => {
  for (const path of ['/', '/g/xxxxxxxxxxxxxxxxxxxxxxxx']) {
    const headers = (await request.get(path)).headers();
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toBe("frame-ancestors 'none'");
    // Advertising the framework only helps someone pick an exploit (seen in production).
    expect(headers['x-powered-by']).toBeUndefined();
  }
  const group = (await request.get('/g/xxxxxxxxxxxxxxxxxxxxxxxx')).headers();
  expect(group['x-robots-tag']).toBe('noindex, nofollow');
});
