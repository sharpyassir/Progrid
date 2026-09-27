-- Custom domains are served only after an ownership check; existing ones get a token and start unverified.
ALTER TABLE "PlatformApp" ADD COLUMN "domainChecks" JSONB NOT NULL DEFAULT '{}';
UPDATE "PlatformApp" SET "domainChecks" = (
  SELECT jsonb_object_agg(d, jsonb_build_object('token', md5(random()::text || d), 'verifiedAt', NULL))
  FROM unnest("customDomains") AS d
) WHERE cardinality("customDomains") > 0;

-- App hosts are usable only while their agent reports Docker and Caddy running.
ALTER TABLE "AppHost" ADD COLUMN "readyAt" TIMESTAMP(3);
