-- Restore a server from a snapshot, and create a server from a snapshot.
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'restore';
ALTER TABLE "Server" ADD COLUMN "sourceSnapshotId" TEXT;
