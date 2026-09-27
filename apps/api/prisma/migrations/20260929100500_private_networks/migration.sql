-- Per project private networks with statically allocated addresses (net0).
CREATE TABLE "PrivateNetwork" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "poolIndex" INTEGER NOT NULL,
    "vxlanTag" INTEGER NOT NULL,
    "vnet" TEXT NOT NULL,
    "sdnAppliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateNetwork_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PrivateIp" (
    "id" TEXT NOT NULL,
    "networkId" TEXT NOT NULL,
    "serverId" TEXT,
    "address" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivateIp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivateNetwork_projectId_regionId_key" ON "PrivateNetwork"("projectId", "regionId");
CREATE UNIQUE INDEX "PrivateNetwork_regionId_cidr_key" ON "PrivateNetwork"("regionId", "cidr");
CREATE UNIQUE INDEX "PrivateNetwork_regionId_poolIndex_key" ON "PrivateNetwork"("regionId", "poolIndex");
CREATE UNIQUE INDEX "PrivateIp_serverId_key" ON "PrivateIp"("serverId");
CREATE UNIQUE INDEX "PrivateIp_networkId_address_key" ON "PrivateIp"("networkId", "address");

ALTER TABLE "PrivateNetwork" ADD CONSTRAINT "PrivateNetwork_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivateNetwork" ADD CONSTRAINT "PrivateNetwork_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrivateIp" ADD CONSTRAINT "PrivateIp_networkId_fkey" FOREIGN KEY ("networkId") REFERENCES "PrivateNetwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrivateIp" ADD CONSTRAINT "PrivateIp_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;
