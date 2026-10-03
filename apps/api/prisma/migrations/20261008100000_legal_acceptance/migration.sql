-- Clickwrap acceptance of the legal documents (modules/legal). Existing users have no version and
-- are asked to accept before they can keep using the console or the API.
ALTER TABLE "prgd_users" ADD COLUMN "legalVersion" TEXT;
ALTER TABLE "prgd_users" ADD COLUMN "legalAcceptedAt" TIMESTAMP(3);

CREATE TABLE "prgd_legal_acceptances" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "documents" TEXT[],
    "entity" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_legal_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prgd_legal_acceptances_userId_createdAt_idx" ON "prgd_legal_acceptances"("userId", "createdAt");

ALTER TABLE "prgd_legal_acceptances" ADD CONSTRAINT "prgd_legal_acceptances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "prgd_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
