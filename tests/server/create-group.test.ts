import { beforeEach, describe, expect, it } from 'vitest';
import { createGroup, deleteGroup } from '../../src/server/actions/group';
import { prisma } from '../../src/server/db';
import { resetRateLimit } from '../../src/server/rate-limit';
import { resetDb } from './reset';

describe('createGroup', () => {
  beforeEach(async () => {
    await resetDb();
    resetRateLimit();
  });

  it('creates group + participants + activity entry, returns 24-char token', async () => {
    const result = await createGroup({ name: 'Viaje a Roma', participantNames: ['Ana', 'Beto'] });
    if (!result.ok) throw new Error(result.error);
    expect(result.data.token).toHaveLength(24);
    const group = await prisma.group.findUnique({
      where: { id: result.data.token },
      include: { participants: true, activity: true },
    });
    expect(group?.participants).toHaveLength(2);
    expect(group?.activity[0]).toMatchObject({ action: 'group.create', actorName: null });
  });

  it('rejects fewer than 2 participants with a typed Spanish error', async () => {
    const result = await createGroup({ name: 'Solo', participantNames: ['Ana'] });
    expect(result).toEqual({ ok: false, error: 'Hacen falta al menos 2 participantes' });
  });

  it('rejects duplicate participant names at the Zod level, not as a DB violation', async () => {
    const result = await createGroup({ name: 'Dup', participantNames: ['Ana', 'Ana'] });
    expect(result).toMatchObject({ ok: false, error: 'Participante duplicado: Ana' });
  });

  it('rate-limits after 10 creations from one IP', async () => {
    for (let i = 0; i < 10; i++) {
      const result = await createGroup({ name: `G${i}`, participantNames: ['Ana', 'Beto'] });
      expect(result.ok).toBe(true);
    }
    const blocked = await createGroup({ name: 'G11', participantNames: ['Ana', 'Beto'] });
    expect(blocked).toMatchObject({ ok: false, error: expect.stringContaining('Demasiadas solicitudes') });
  });
});

describe('deleteGroup', () => {
  beforeEach(async () => {
    await resetDb();
    resetRateLimit();
  });

  it('requires the exact group name as confirmation', async () => {
    const created = await createGroup({ name: 'Viaje', participantNames: ['Ana', 'Beto'] });
    if (!created.ok) throw new Error(created.error);
    const wrong = await deleteGroup(created.data.token, 'viaje');
    expect(wrong.ok).toBe(false);
    const right = await deleteGroup(created.data.token, 'Viaje');
    expect(right.ok).toBe(true);
    expect(await prisma.group.count()).toBe(0);
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('a group name pasted with invisible characters can still be typed to delete it', async () => {
    const created = await createGroup({ name: '\u2060Pe\u00f1a  del pueblo', participantNames: ['Ana', 'Beto'] });
    if (!created.ok) throw new Error(created.error);
    expect((await deleteGroup(created.data.token, 'Pe\u00f1a del pueblo')).ok).toBe(true);
  });

  it('unknown token fails with the same generic message (no existence leak)', async () => {
    const result = await deleteGroup('x'.repeat(24), 'Nombre');
    expect(result).toEqual({ ok: false, error: 'Grupo no encontrado' });
  });
});
