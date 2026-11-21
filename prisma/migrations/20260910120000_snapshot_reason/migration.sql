-- AlterTable
ALTER TABLE `snapshots` ADD COLUMN `reason` ENUM('ledger_miss', 'raw_copy') NULL;

-- CreateIndex
CREATE INDEX `snapshots_reason_captured_at_idx` ON `snapshots`(`reason`, `captured_at`);
