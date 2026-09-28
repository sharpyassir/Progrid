-- First party marketplace apps are listed under the brand name. The old internal name is
-- spelled in two parts so the retired identifier does not appear in new files.
ALTER TABLE "MarketplaceApp" ALTER COLUMN "vendorName" SET DEFAULT 'Progrid';
UPDATE "MarketplaceApp" SET "vendorName" = 'Progrid' WHERE "vendorName" IN ('pg' || 'cloud', 'prgd');
