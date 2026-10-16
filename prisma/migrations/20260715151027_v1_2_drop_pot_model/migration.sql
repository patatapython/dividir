/*
  Warnings:

  - You are about to drop the column `isPot` on the `Participant` table. All the data in the column will be lost.
  - You are about to drop the column `potKind` on the `Participant` table. All the data in the column will be lost.
  - You are about to drop the `Round` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Round" DROP CONSTRAINT "Round_groupId_fkey";

-- DropForeignKey
ALTER TABLE "Round" DROP CONSTRAINT "Round_potParticipantId_fkey";

-- AlterTable
ALTER TABLE "Participant" DROP COLUMN "isPot",
DROP COLUMN "potKind";

-- DropTable
DROP TABLE "Round";
