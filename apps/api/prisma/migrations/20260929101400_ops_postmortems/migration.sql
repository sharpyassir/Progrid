-- DevOps console, step 7: postmortems after every managed P1, and the resolved_pending_pm ticket
-- status (customers see it as closed).

-- CreateEnum
CREATE TYPE "prgd_postmortem_status" AS ENUM ('DRAFT', 'SUBMITTED', 'CLOSED');

-- AlterEnum
ALTER TYPE "prgd_ticket_status" ADD VALUE 'resolved_pending_pm';

-- CreateTable
CREATE TABLE "prgd_postmortems" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "timeline" TEXT NOT NULL DEFAULT '',
    "impact" TEXT NOT NULL DEFAULT '',
    "rootCause" TEXT NOT NULL DEFAULT '',
    "fix" TEXT NOT NULL DEFAULT '',
    "prevention" TEXT NOT NULL DEFAULT '',
    "status" "prgd_postmortem_status" NOT NULL DEFAULT 'DRAFT',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeComment" TEXT,
    "remindedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_postmortems_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prgd_postmortems_ticketId_key" ON "prgd_postmortems"("ticketId");

-- CreateIndex
CREATE INDEX "prgd_postmortems_status_dueAt_idx" ON "prgd_postmortems"("status", "dueAt");

-- AddForeignKey
ALTER TABLE "prgd_postmortems" ADD CONSTRAINT "prgd_postmortems_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "prgd_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

