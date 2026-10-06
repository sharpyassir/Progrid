-- Authentication hardening (ISO 27001 A.5.15-A.5.18, A.8.5): per account lockout, TOTP replay
-- protection, explicit full back office role, and one time ops second factor enrollment.

ALTER TABLE "prgd_users" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "prgd_users" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "prgd_users" ADD COLUMN "lockoutCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "prgd_users" ADD COLUMN "lastTotpStep" INTEGER;

ALTER TABLE "prgd_engineer_profiles" ADD COLUMN "enrolledAt" TIMESTAMP(3);
-- Engineers who already have a second factor enrolled long ago; the window must not reopen for them.
UPDATE "prgd_engineer_profiles" p SET "enrolledAt" = p."createdAt"
  WHERE EXISTS (SELECT 1 FROM "prgd_users" u WHERE u."id" = p."userId" AND u."totpEnabled")
     OR EXISTS (SELECT 1 FROM "prgd_webauthn_credentials" w WHERE w."userId" = p."userId");

-- An empty role list used to mean full back office access; it now means none. Existing full staff
-- keep their access through the explicit role.
UPDATE "prgd_users" SET "staffRoles" = ARRAY['full_admin']::TEXT[]
  WHERE "isStaff" AND cardinality("staffRoles") = 0;
