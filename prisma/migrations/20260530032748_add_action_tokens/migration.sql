-- CreateTable
CREATE TABLE "action_tokens" (
    "id" TEXT NOT NULL,
    "tracking_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "action_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "action_tokens_token_key" ON "action_tokens"("token");

-- CreateIndex
CREATE INDEX "action_tokens_token_idx" ON "action_tokens"("token");

-- CreateIndex
CREATE INDEX "action_tokens_tracking_id_idx" ON "action_tokens"("tracking_id");

-- AddForeignKey
ALTER TABLE "action_tokens" ADD CONSTRAINT "action_tokens_tracking_id_fkey" FOREIGN KEY ("tracking_id") REFERENCES "contract_trackings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
