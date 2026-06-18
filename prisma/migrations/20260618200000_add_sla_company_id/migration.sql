-- Adiciona company_id ao SlaRule para configuração por empresa
ALTER TABLE "sla_rules" ADD COLUMN "company_id" TEXT;

-- Remove o unique constraint anterior (só por stepName)
DROP INDEX IF EXISTS "sla_rules_step_name_key";
ALTER TABLE "sla_rules" DROP CONSTRAINT IF EXISTS "sla_rules_step_name_key";

-- Adiciona novo unique constraint composto (stepName, companyId)
-- Em PostgreSQL, NULLs são tratados como distintos em unique constraints,
-- portanto as regras globais (company_id IS NULL) são protegidas a nível de app.
CREATE UNIQUE INDEX "sla_rules_step_name_company_id_key" ON "sla_rules"("step_name", "company_id");
