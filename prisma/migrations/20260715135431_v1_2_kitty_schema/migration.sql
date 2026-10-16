-- CreateTable
CREATE TABLE "Kitty" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "parkedExtraCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Kitty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KittyRound" (
    "id" TEXT NOT NULL,
    "kittyId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT,
    "carryInCents" INTEGER NOT NULL DEFAULT 0,
    "closeAction" TEXT,
    "payoutSnapshot" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "KittyRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KittyContribution" (
    "id" TEXT NOT NULL,
    "kittyRoundId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "KittyContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KittySpend" (
    "id" TEXT NOT NULL,
    "kittyRoundId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KittySpend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Kitty_groupId_key" ON "Kitty"("groupId");

-- AddForeignKey
ALTER TABLE "Kitty" ADD CONSTRAINT "Kitty_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyRound" ADD CONSTRAINT "KittyRound_kittyId_fkey" FOREIGN KEY ("kittyId") REFERENCES "Kitty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyRound" ADD CONSTRAINT "KittyRound_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyContribution" ADD CONSTRAINT "KittyContribution_kittyRoundId_fkey" FOREIGN KEY ("kittyRoundId") REFERENCES "KittyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittyContribution" ADD CONSTRAINT "KittyContribution_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KittySpend" ADD CONSTRAINT "KittySpend_kittyRoundId_fkey" FOREIGN KEY ("kittyRoundId") REFERENCES "KittyRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
