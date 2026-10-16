/**
 * "Tus grupos" (T-41): the groups this device has visited, so a group can be found again
 * without its link. Stored only in this browser. The list holds group links, which are
 * credentials, so it never leaves the device and a link that leads nowhere is forgotten.
 */
export interface RecentGroup {
  token: string;
  name: string;
  visitedAt: number;
}

export const RECENT_GROUPS_KEY = 'dividir:groups';
export const MAX_RECENT_GROUPS = 20;

// A group token is nanoid(24): the URL-safe alphabet, 24 characters.
const TOKEN = /^[A-Za-z0-9_-]{24}$/;

function isRecentGroup(value: unknown): value is RecentGroup {
  if (typeof value !== 'object' || value === null) return false;
  const g = value as Record<string, unknown>;
  return typeof g.token === 'string' && TOKEN.test(g.token) && typeof g.name === 'string' && typeof g.visitedAt === 'number';
}

/** Whatever is stored (possibly nothing, possibly garbage) as a list of well-formed groups. */
export function parseRecentGroups(raw: string | null): RecentGroup[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRecentGroup) : [];
  } catch {
    return [];
  }
}

/** The visited group goes first, with its current name; the least recent fall off the end. */
export function rememberGroup(list: RecentGroup[], group: { token: string; name: string }, now: number): RecentGroup[] {
  return [{ ...group, visitedAt: now }, ...forgetGroup(list, group.token)].slice(0, MAX_RECENT_GROUPS);
}

export function forgetGroup(list: RecentGroup[], token: string): RecentGroup[] {
  return list.filter((g) => g.token !== token);
}

/**
 * The token of a group link whose group does not exist. Only the unknown-group boundary
 * (`app/g/not-found.tsx`) asks, and reaching it means the group layout found no group for
 * that token, so any page below it counts, not only the home.
 */
export function missingGroupToken(pathname: string): string | null {
  const match = /^\/g\/([^/]+)(?:\/|$)/.exec(pathname);
  return match && TOKEN.test(match[1]) ? match[1] : null;
}
