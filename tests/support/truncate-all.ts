/**
 * Empties every application table in one statement. The table list is read
 * from the catalog, so a schema change can never leave a test reset stale
 * (a hand-kept list once kept truncating a dropped table and broke the suite).
 * `_prisma_migrations` is kept so `migrate deploy` stays a no-op afterwards.
 */
export const TRUNCATE_ALL_SQL = `
DO $$
BEGIN
  EXECUTE (
    SELECT 'TRUNCATE ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' CASCADE'
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  );
END $$;
`;
