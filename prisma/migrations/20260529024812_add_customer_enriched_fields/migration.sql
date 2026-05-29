-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "contact_name" TEXT,
ADD COLUMN     "contact_phone" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "pipedrive_org_id" TEXT,
ADD COLUMN     "pipedrive_org_raw" JSONB,
ADD COLUMN     "pipedrive_person_id" TEXT,
ADD COLUMN     "pipedrive_person_raw" JSONB,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "zip_code" TEXT;
