-- AlterTable
ALTER TABLE "pipedrive_deals" ADD COLUMN "company_id" TEXT;

-- Backfill: popula company_id a partir do rawPayload já armazenado
UPDATE "pipedrive_deals"
SET "company_id" = "raw_payload"->'meta'->>'company_id'
WHERE "raw_payload" IS NOT NULL
  AND "raw_payload"->'meta'->>'company_id' IS NOT NULL;

-- Índice para acelerar o filtro por empresa
CREATE INDEX "pipedrive_deals_company_id_idx" ON "pipedrive_deals"("company_id");
