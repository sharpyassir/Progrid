-- Customer facing names must not say where servers are. The region id stays "sa1".
UPDATE "prgd_regions" SET "name" = 'Region 1' WHERE "id" = 'sa1';

-- The Nextcloud listing claimed data stays in Saudi Arabia. Only replace the seeded text.
UPDATE "prgd_marketplace_apps"
SET "summary" = 'Self-hosted files, calendar and office on your own server.'
WHERE "id" = 'nextcloud' AND "summary" LIKE '%Saudi%';

UPDATE "prgd_marketplace_apps"
SET "description" = 'Nextcloud Hub with MariaDB and Redis. Your files live on your own server, not on a third party service.'
WHERE "id" = 'nextcloud' AND "description" LIKE '%Saudi%';
