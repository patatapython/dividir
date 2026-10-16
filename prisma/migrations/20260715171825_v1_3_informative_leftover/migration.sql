/*
  Warnings:

  - You are about to drop the column `parkedExtraCents` on the `Kitty` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Kitty" DROP COLUMN "parkedExtraCents";

-- v1.3 data rewrite: GUARDAR semantics (park the surplus) no longer exist;
-- closed rounds keep their rows and now expose a purely informational leftover.
UPDATE "KittyRound" SET "closeAction" = 'CERRAR' WHERE "closeAction" = 'GUARDAR';
