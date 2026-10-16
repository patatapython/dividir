-- Session 11 (F-02, F-03): names are stored clean and a person is unique per group
-- regardless of capitals. Mirrors src/domain/text.ts (normalizeText, personNameKey).
--
-- The unique index on ("groupId", lower(name)) is MIGRATION-ONLY: Prisma's DSL cannot
-- express an expression index, so a generated migration that diffs against the DSL
-- would try to DROP it. Author later migrations with --create-only and remove any
-- generated DROP of "Participant_groupId_name_ci_key" (pinned by tests/server/schema.test.ts).

CREATE FUNCTION pg_temp.clean_text(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(normalize(raw, NFC), '[­᠎​‎‏‪-‮⁠-⁤⁦-⁯﻿]', '', 'g'),
    '[\t\n\u000B\f\r    -     　]+', ' ', 'g'))
$$;

-- Two people who would become the same name are never merged or renamed here: the
-- migration stops and names them, for a person to decide.
DO $$
DECLARE
  clash text;
BEGIN
  SELECT string_agg(format('group %s: %s', "groupId", names), '; ')
  INTO clash
  FROM (
    SELECT "groupId", string_agg(quote_literal(name), ', ') AS names
    FROM "Participant"
    GROUP BY "groupId", lower(pg_temp.clean_text(name))
    HAVING count(*) > 1
  ) AS clashes;
  IF clash IS NOT NULL THEN
    RAISE EXCEPTION 'Participants that would share a name once cleaned (rename one first): %', clash;
  END IF;
END $$;

UPDATE "Participant" SET name = pg_temp.clean_text(name) WHERE name <> pg_temp.clean_text(name);
UPDATE "Group" SET name = pg_temp.clean_text(name) WHERE name <> pg_temp.clean_text(name);

CREATE UNIQUE INDEX "Participant_groupId_name_ci_key" ON "Participant" ("groupId", lower(name));
