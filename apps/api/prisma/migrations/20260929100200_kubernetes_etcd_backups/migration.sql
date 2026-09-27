-- Daily etcd snapshots of managed Kubernetes clusters go to a platform owned bucket.
ALTER TABLE "KubeCluster" ADD COLUMN "backupBucket" TEXT;
ALTER TABLE "KubeCluster" ADD COLUMN "backupAccessKey" TEXT;
ALTER TABLE "KubeCluster" ADD COLUMN "backupSecretKey" TEXT;
