/*
  Warnings:

  - The primary key for the `ExpensePayer` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - A unique constraint covering the columns `[expenseId,participantId]` on the table `ExpensePayer` will be added. If there are existing duplicate values, this will fail.
  - The required column `id` was added to the `ExpensePayer` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.

*/
-- AlterTable: ExpensePayer gains an own id PK because a nullable participantId
-- (null = "dinero de nadie") can no longer be part of a composite PK. Add id as
-- nullable, backfill existing rows deterministically from the old composite key
-- (unique by construction; participantId is still NOT NULL at this point), then
-- enforce NOT NULL + PK. On a fresh prod DB the UPDATE touches 0 rows.
ALTER TABLE "ExpensePayer" DROP CONSTRAINT "ExpensePayer_pkey";
ALTER TABLE "ExpensePayer" ADD COLUMN "id" TEXT;
UPDATE "ExpensePayer" SET "id" = "expenseId" || '/' || "participantId" WHERE "id" IS NULL;
ALTER TABLE "ExpensePayer" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "ExpensePayer" ADD CONSTRAINT "ExpensePayer_pkey" PRIMARY KEY ("id");
ALTER TABLE "ExpensePayer" ALTER COLUMN "participantId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GroupCharge" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "splitMode" "SplitMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupChargeShare" (
    "chargeId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "shareInput" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "GroupChargeShare_pkey" PRIMARY KEY ("chargeId","participantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpensePayer_expenseId_participantId_key" ON "ExpensePayer"("expenseId", "participantId");

-- AddForeignKey
ALTER TABLE "GroupCharge" ADD CONSTRAINT "GroupCharge_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupChargeShare" ADD CONSTRAINT "GroupChargeShare_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "GroupCharge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupChargeShare" ADD CONSTRAINT "GroupChargeShare_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
