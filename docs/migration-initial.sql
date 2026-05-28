-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('IN_PROGRESS', 'DELAYED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED');

-- CreateEnum
CREATE TYPE "StepName" AS ENUM ('PROPOSAL_ACCEPTED', 'CONTRACT_PREPARATION', 'CONTRACT_SIGNING', 'CONTRACT_REGISTRATION', 'CONTRACT_BILLING');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OPERATOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipedrive_deals" (
    "id" TEXT NOT NULL,
    "external_deal_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "stage_name" TEXT NOT NULL,
    "stage_id" TEXT,
    "customer_id" TEXT,
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipedrive_deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_trackings" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "pipedrive_deal_id" TEXT NOT NULL,
    "current_step" "StepName" NOT NULL DEFAULT 'PROPOSAL_ACCEPTED',
    "overall_status" "ContractStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "assigned_user_id" TEXT,
    "proposal_accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_trackings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_steps" (
    "id" TEXT NOT NULL,
    "contract_tracking_id" TEXT NOT NULL,
    "step_name" "StepName" NOT NULL,
    "step_order" INTEGER NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "assigned_user_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "step_histories" (
    "id" TEXT NOT NULL,
    "contract_step_id" TEXT NOT NULL,
    "from_status" TEXT,
    "to_status" TEXT NOT NULL,
    "changed_by_user_id" TEXT,
    "change_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_histories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clicksign_documents" (
    "id" TEXT NOT NULL,
    "contract_tracking_id" TEXT NOT NULL,
    "external_document_id" TEXT,
    "external_envelope_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "signed_at" TIMESTAMP(3),
    "raw_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clicksign_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_event_id" TEXT,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_rules" (
    "id" TEXT NOT NULL,
    "step_name" "StepName" NOT NULL,
    "business_days" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "pipedrive_deals_external_deal_id_key" ON "pipedrive_deals"("external_deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_trackings_pipedrive_deal_id_key" ON "contract_trackings"("pipedrive_deal_id");

-- CreateIndex
CREATE INDEX "contract_trackings_overall_status_idx" ON "contract_trackings"("overall_status");

-- CreateIndex
CREATE INDEX "contract_trackings_current_step_idx" ON "contract_trackings"("current_step");

-- CreateIndex
CREATE INDEX "contract_trackings_assigned_user_id_idx" ON "contract_trackings"("assigned_user_id");

-- CreateIndex
CREATE INDEX "contract_trackings_proposal_accepted_at_idx" ON "contract_trackings"("proposal_accepted_at");

-- CreateIndex
CREATE INDEX "contract_trackings_customer_id_idx" ON "contract_trackings"("customer_id");

-- CreateIndex
CREATE INDEX "contract_steps_status_idx" ON "contract_steps"("status");

-- CreateIndex
CREATE INDEX "contract_steps_due_at_idx" ON "contract_steps"("due_at");

-- CreateIndex
CREATE INDEX "contract_steps_contract_tracking_id_idx" ON "contract_steps"("contract_tracking_id");

-- CreateIndex
CREATE UNIQUE INDEX "contract_steps_contract_tracking_id_step_name_key" ON "contract_steps"("contract_tracking_id", "step_name");

-- CreateIndex
CREATE INDEX "step_histories_contract_step_id_idx" ON "step_histories"("contract_step_id");

-- CreateIndex
CREATE INDEX "step_histories_created_at_idx" ON "step_histories"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "clicksign_documents_external_document_id_key" ON "clicksign_documents"("external_document_id");

-- CreateIndex
CREATE INDEX "clicksign_documents_contract_tracking_id_idx" ON "clicksign_documents"("contract_tracking_id");

-- CreateIndex
CREATE INDEX "webhook_events_source_idx" ON "webhook_events"("source");

-- CreateIndex
CREATE INDEX "webhook_events_processed_idx" ON "webhook_events"("processed");

-- CreateIndex
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sla_rules_step_name_key" ON "sla_rules"("step_name");

-- AddForeignKey
ALTER TABLE "pipedrive_deals" ADD CONSTRAINT "pipedrive_deals_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_trackings" ADD CONSTRAINT "contract_trackings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_trackings" ADD CONSTRAINT "contract_trackings_pipedrive_deal_id_fkey" FOREIGN KEY ("pipedrive_deal_id") REFERENCES "pipedrive_deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_trackings" ADD CONSTRAINT "contract_trackings_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_steps" ADD CONSTRAINT "contract_steps_contract_tracking_id_fkey" FOREIGN KEY ("contract_tracking_id") REFERENCES "contract_trackings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_steps" ADD CONSTRAINT "contract_steps_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_histories" ADD CONSTRAINT "step_histories_contract_step_id_fkey" FOREIGN KEY ("contract_step_id") REFERENCES "contract_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "step_histories" ADD CONSTRAINT "step_histories_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clicksign_documents" ADD CONSTRAINT "clicksign_documents_contract_tracking_id_fkey" FOREIGN KEY ("contract_tracking_id") REFERENCES "contract_trackings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

