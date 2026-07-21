-- AlterTable
ALTER TABLE "beneficiary_notify_rules" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'GLOBAL';

-- AlterTable
ALTER TABLE "sla_rules" ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'GLOBAL';
