-- DropIndex
DROP INDEX "pipedrive_deals_company_id_idx";

-- AlterTable
ALTER TABLE "sla_rules" ADD COLUMN     "notify_emails" TEXT,
ADD COLUMN     "notify_on_new_lead" BOOLEAN NOT NULL DEFAULT false;
