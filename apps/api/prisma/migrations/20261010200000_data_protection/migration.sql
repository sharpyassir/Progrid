-- Data protection (ISO 27001 A.8.15 / NCA ECC 2-12): a tamper evident, append only audit log.
--
-- 1. seq orders the hash chain. Existing rows are numbered by (at, id) so the order is stable.
-- 2. prevHash / hash: each row written by the API carries hash = sha256(prevHash | canonical row),
--    computed by EventsService under an advisory lock (rows from before this migration have no
--    hash; the chain starts at the first hashed row). verify-audit-chain walks it.
-- 3. A trigger refuses UPDATE, DELETE and TRUNCATE. The retention job deletes rows past
--    AUDIT_RETENTION_DAYS inside a transaction that runs SET LOCAL prgd.audit_purge = 'on'.
--    (Note: deleting a user would now fail on the ON DELETE SET NULL of userId; accounts are
--    anonymised instead of deleted, see DELETE /v1/account.)

ALTER TABLE "prgd_audit_logs" ADD COLUMN "seq" BIGINT;
ALTER TABLE "prgd_audit_logs" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "prgd_audit_logs" ADD COLUMN "hash" TEXT;

CREATE SEQUENCE "prgd_audit_logs_seq_seq" AS BIGINT OWNED BY "prgd_audit_logs"."seq";

UPDATE "prgd_audit_logs" a SET "seq" = o.n
FROM (SELECT "id", row_number() OVER (ORDER BY "at", "id") AS n FROM "prgd_audit_logs") o
WHERE a."id" = o."id";

SELECT setval('"prgd_audit_logs_seq_seq"', COALESCE((SELECT max("seq") FROM "prgd_audit_logs"), 0) + 1, false);

ALTER TABLE "prgd_audit_logs" ALTER COLUMN "seq" SET DEFAULT nextval('"prgd_audit_logs_seq_seq"');
ALTER TABLE "prgd_audit_logs" ALTER COLUMN "seq" SET NOT NULL;

CREATE UNIQUE INDEX "prgd_audit_logs_seq_key" ON "prgd_audit_logs"("seq");
CREATE INDEX "prgd_audit_logs_at_idx" ON "prgd_audit_logs"("at");

CREATE OR REPLACE FUNCTION "prgd_audit_logs_append_only"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('prgd.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'prgd_audit_logs is append only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege',
          HINT = 'Only the retention job may delete rows (SET LOCAL prgd.audit_purge = ''on'').';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "prgd_audit_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "prgd_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "prgd_audit_logs_append_only"();

CREATE TRIGGER "prgd_audit_logs_no_truncate"
  BEFORE TRUNCATE ON "prgd_audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "prgd_audit_logs_append_only"();
