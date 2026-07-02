-- AlterTable
ALTER TABLE "clicksign_field_mappings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "contract_steps" ADD COLUMN     "delay_notified_at" TIMESTAMP(3);

-- RenameIndex
ALTER INDEX "clicksign_field_mappings_source_clicksign_type_key" RENAME TO "clicksign_field_mappings_source_field_clicksign_placeholder_key";
