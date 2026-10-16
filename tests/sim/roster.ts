import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Who the simulated big group is made of. The owner's real group is loaded from a
 * git-ignored file (`roster.local.json`: `{ "founders": [...], "lateJoiners": [...] }`)
 * so real names never reach the repository; without it a generic roster of the same
 * shape is used, and the simulation behaves the same.
 */
export interface Roster {
  founders: string[];
  lateJoiners: string[];
}

const LOCAL_ROSTER = fileURLToPath(new URL('./roster.local.json', import.meta.url));

const GENERIC: Roster = {
  founders: [
    'Ana', 'Beto', 'Carla', 'Dani', 'Elena', 'Fran', 'Gloria', 'Héctor', 'Inés', 'Javi',
    'Karen', 'Luis', 'Marta', 'Nacho', 'Olga', 'Pedro', 'Quique', 'Rosa', 'Sergio',
    'Tania', 'Úrsula', 'Vicente', 'Wendy', 'Xavi',
  ],
  lateJoiners: ['Yolanda', 'Zoe', 'Álex', 'Bruno', 'Cris', 'Diana'],
};

export function loadRoster(): Roster {
  if (!existsSync(LOCAL_ROSTER)) return GENERIC;
  const parsed = JSON.parse(readFileSync(LOCAL_ROSTER, 'utf8')) as Roster;
  if (!Array.isArray(parsed.founders) || !Array.isArray(parsed.lateJoiners)) {
    throw new Error('roster.local.json needs "founders" and "lateJoiners" arrays');
  }
  return parsed;
}
