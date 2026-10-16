import { vi } from 'vitest';

/** In-memory cookie jar shared with tests (claim assertions, actor identity). */
export const cookieJar = new Map<string, string>();

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
  }),
  headers: async () => new Headers({ 'x-forwarded-for': '127.0.0.1' }),
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
  redirect: vi.fn(),
}));
