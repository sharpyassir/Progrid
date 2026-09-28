-- DevOps console, step 6: shift start and end with the start checklist, and handovers.

-- AlterTable
ALTER TABLE "prgd_on_call_shifts" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "handoverEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "handoverRemindedAt" TIMESTAMP(3),
ADD COLUMN     "startChecklist" JSONB,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "prgd_handovers" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "openTickets" JSONB NOT NULL DEFAULT '[]',
    "risks" TEXT NOT NULL DEFAULT '',
    "pendingMaintenance" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "readBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prgd_handovers_shiftId_key" ON "prgd_handovers"("shiftId");

-- CreateIndex
CREATE INDEX "prgd_handovers_createdAt_idx" ON "prgd_handovers"("createdAt");

-- AddForeignKey
ALTER TABLE "prgd_handovers" ADD CONSTRAINT "prgd_handovers_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "prgd_on_call_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

