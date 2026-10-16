-- CreateIndex
CREATE INDEX "ActivityLog_groupId_createdAt_idx" ON "ActivityLog"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "Expense_groupId_idx" ON "Expense"("groupId");

-- CreateIndex
CREATE INDEX "ExpenseItem_expenseId_idx" ON "ExpenseItem"("expenseId");

-- CreateIndex
CREATE INDEX "ExpensePayer_participantId_idx" ON "ExpensePayer"("participantId");

-- CreateIndex
CREATE INDEX "ExpenseShare_participantId_idx" ON "ExpenseShare"("participantId");

-- CreateIndex
CREATE INDEX "GroupCharge_groupId_idx" ON "GroupCharge"("groupId");

-- CreateIndex
CREATE INDEX "GroupChargeShare_participantId_idx" ON "GroupChargeShare"("participantId");

-- CreateIndex
CREATE INDEX "KittyContribution_kittyRoundId_idx" ON "KittyContribution"("kittyRoundId");

-- CreateIndex
CREATE INDEX "KittyContribution_participantId_idx" ON "KittyContribution"("participantId");

-- CreateIndex
CREATE INDEX "KittyRound_groupId_closedAt_idx" ON "KittyRound"("groupId", "closedAt");

-- CreateIndex
CREATE INDEX "KittyRound_kittyId_idx" ON "KittyRound"("kittyId");

-- CreateIndex
CREATE INDEX "KittySpend_kittyRoundId_idx" ON "KittySpend"("kittyRoundId");

-- CreateIndex
CREATE INDEX "Payment_groupId_idx" ON "Payment"("groupId");

-- CreateIndex
CREATE INDEX "Payment_fromId_idx" ON "Payment"("fromId");

-- CreateIndex
CREATE INDEX "Payment_toId_idx" ON "Payment"("toId");

-- CreateIndex
CREATE INDEX "Refund_groupId_idx" ON "Refund"("groupId");

-- CreateIndex
CREATE INDEX "Refund_expenseId_idx" ON "Refund"("expenseId");

-- CreateIndex
CREATE INDEX "Refund_receivedById_idx" ON "Refund"("receivedById");
