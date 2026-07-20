-- AlterTable
ALTER TABLE "contract_trackings" ADD COLUMN     "beneficiaries_defined_at" TIMESTAMP(3),
ADD COLUMN     "beneficiaries_requested_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "contract_beneficiaries" (
    "id" TEXT NOT NULL,
    "contract_tracking_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "nome" TEXT,
    "cpf" TEXT,
    "razao_social" TEXT,
    "cnpj" TEXT,
    "endereco" TEXT,
    "pipedrive_person_id" TEXT,
    "pipedrive_org_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiary_notify_rules" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "notify_emails" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beneficiary_notify_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contract_beneficiaries_contract_tracking_id_idx" ON "contract_beneficiaries"("contract_tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "beneficiary_notify_rules_company_id_key" ON "beneficiary_notify_rules"("company_id");

-- AddForeignKey
ALTER TABLE "contract_beneficiaries" ADD CONSTRAINT "contract_beneficiaries_contract_tracking_id_fkey" FOREIGN KEY ("contract_tracking_id") REFERENCES "contract_trackings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
