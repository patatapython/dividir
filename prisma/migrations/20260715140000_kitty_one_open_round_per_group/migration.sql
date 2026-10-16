-- M1 backstop (spec §5): at most one OPEN round (closedAt IS NULL) per group.
-- Partial unique index. Prisma's schema DSL cannot express a WHERE-filtered
-- index, so this lives only in the migration. A future `prisma migrate dev`
-- will see it as drift and try to DROP it — do NOT accept that; author later
-- migrations with `--create-only` and remove any generated DROP of this index.
CREATE UNIQUE INDEX "KittyRound_one_open_per_group" ON "KittyRound" ("groupId") WHERE "closedAt" IS NULL;
