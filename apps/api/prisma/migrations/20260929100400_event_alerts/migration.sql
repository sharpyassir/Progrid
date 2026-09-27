-- Event based alert rules: managed database node unreachable, App Platform deploy failed.
ALTER TYPE "AlertMetric" ADD VALUE 'db_node_unreachable';
ALTER TYPE "AlertMetric" ADD VALUE 'app_deploy_failed';
