-- CreateTable
CREATE TABLE "clicksign_field_mappings" (
    "id" TEXT NOT NULL,
    "source_field" TEXT NOT NULL,
    "clicksign_placeholder" TEXT NOT NULL,
    "contract_type" TEXT NOT NULL DEFAULT 'all',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clicksign_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clicksign_field_mappings_source_clicksign_type_key"
ON "clicksign_field_mappings"("source_field", "clicksign_placeholder", "contract_type");

-- Seed: mapeamentos atuais hardcoded no clicksign.service.ts
INSERT INTO "clicksign_field_mappings" ("id", "source_field", "clicksign_placeholder", "contract_type", "active", "created_at", "updated_at") VALUES
-- PJ: dados da empresa
(gen_random_uuid(), 'customer.name',         'NOME_EMPRESA',         'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.document',     'CNPJ',                 'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.address',      'Logradouro',           'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.city',         'Cidade',               'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.state',        'Estado',               'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.zipCode',      'CEP_Empresa',          'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.email',        'E-mail_Empresa',       'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.phone',        'Telefone_Empresa',     'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.phone',        'Celular_Empresa',      'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.phone',        'WhatsApp_Empresa',     'PJ', true, NOW(), NOW()),
-- PJ: representante
(gen_random_uuid(), 'customer.contactName',  'Nome_REPRES',          'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.contactEmail', 'E-mail Representante', 'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.contactPhone', 'Telefone_REPRES',      'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.contactPhone', 'Celular_REPRES',       'PJ', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.contactPhone', 'WhatsApp_REPRES',      'PJ', true, NOW(), NOW()),
-- PF
(gen_random_uuid(), 'customer.contactName|customer.name', 'Nome',      'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.document',     'CPF',                  'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.contactEmail', 'E-mail',               'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.contactPhone', 'Telefone',             'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.contactPhone', 'Celular',              'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.contactPhone', 'WhatsApp',             'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.address',      'Logradouro',           'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.city',         'Cidade',               'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.state',        'Estado',               'PF', true, NOW(), NOW()),
(gen_random_uuid(), 'customer.zipCode',      'CEP',                  'PF', true, NOW(), NOW());
