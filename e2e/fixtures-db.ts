import { execFileSync } from 'node:child_process';
import { E2E_DATABASE_URL } from './e2e-db';

/**
 * Volume fixtures written straight into dividir_e2e, through the same
 * `prisma db execute` that global-setup uses (the generated client is ESM and
 * Playwright loads specs as CommonJS). Only for data a spec needs in bulk and
 * does not test the entry of (e.g. 25 payments to page through); every
 * behaviour under test still goes through the UI.
 */
function execute(sql: string) {
  execFileSync('npx', ['prisma', 'db', 'execute', '--stdin'], {
    input: sql,
    stdio: ['pipe', 'ignore', 'inherit'],
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL },
  });
}

const TOKEN = /^[A-Za-z0-9_-]{24}$/;

/** Every value interpolated into fixture SQL is checked here, not trusted from the caller. */
function checked(groupId: string, count: number): { groupId: string; last: number } {
  if (!TOKEN.test(groupId)) throw new Error(`not a group token: ${groupId}`);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error(`not a row count: ${count}`);
  return { groupId, last: count - 1 };
}

/** The group token of a group URL. */
export function tokenOf(url: string): string {
  const match = url.match(/\/g\/([A-Za-z0-9_-]{24})(?:[/?#]|$)/);
  if (!match) throw new Error(`not a group URL: ${url}`);
  return match[1];
}

/** `count` payments between the group's first two people, one per day going back. */
export function seedPayments(token: string, count: number) {
  const { groupId, last } = checked(token, count);
  execute(`
    WITH people AS (
      SELECT id, row_number() OVER (ORDER BY "createdAt", id) AS n
      FROM "Participant" WHERE "groupId" = '${groupId}'
    )
    INSERT INTO "Payment" (id, "groupId", "fromId", "toId", "amountCents", date)
    SELECT gen_random_uuid()::text, '${groupId}',
      (SELECT id FROM people WHERE n = 1), (SELECT id FROM people WHERE n = 2),
      100 + i, DATE '2026-01-28' - (i % 28)
    FROM generate_series(0, ${last}) AS i;
  `);
}

/** `count` log entries, all older than anything the spec does through the UI. */
export function seedActivity(token: string, count: number) {
  const { groupId, last } = checked(token, count);
  execute(`
    INSERT INTO "ActivityLog" (id, "groupId", "actorName", action, payload, "createdAt")
    SELECT gen_random_uuid()::text, '${groupId}', NULL, 'participant.update',
      jsonb_build_object('previous', jsonb_build_object('name', 'Antes ' || i), 'name', 'Fixture ' || i),
      now() - interval '30 days' - i * interval '1 minute'
    FROM generate_series(0, ${last}) AS i;
  `);
}

/** `count` closed rounds of the bote, all older than the spec's own: each one REPARTIR,
 * one contribution of 5 € paid back to the same person — so every card carries rows of
 * its own (its payout) inside the list of cards. */
export function seedClosedRounds(token: string, count: number) {
  const { groupId, last } = checked(token, count);
  execute(`
    INSERT INTO "Kitty" (id, "groupId") VALUES ('kitty-' || '${groupId}', '${groupId}') ON CONFLICT ("groupId") DO NOTHING;
    WITH rounds AS (
      INSERT INTO "KittyRound" (id, "kittyId", "groupId", name, "closeAction", "payoutSnapshot", "openedAt", "closedAt")
      SELECT gen_random_uuid()::text, (SELECT id FROM "Kitty" WHERE "groupId" = '${groupId}'), '${groupId}',
        'Ronda ' || (i + 1), 'REPARTIR',
        jsonb_build_array(jsonb_build_object('participantId', (SELECT id FROM "Participant" WHERE "groupId" = '${groupId}' ORDER BY "createdAt", id LIMIT 1), 'amountCents', 500)),
        now() - interval '60 days' + i * interval '1 hour',
        now() - interval '60 days' + i * interval '1 hour' + interval '30 minutes'
      FROM generate_series(0, ${last}) AS i
      RETURNING id
    )
    INSERT INTO "KittyContribution" (id, "kittyRoundId", "participantId", "amountCents")
    SELECT gen_random_uuid()::text, rounds.id,
      (SELECT id FROM "Participant" WHERE "groupId" = '${groupId}' ORDER BY "createdAt", id LIMIT 1), 500
    FROM rounds;
  `);
}
