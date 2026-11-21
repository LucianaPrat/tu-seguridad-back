-- AlterTable
ALTER TABLE `alert_events` ADD COLUMN `confidence` DECIMAL(4, 3) NULL,
    ADD COLUMN `persons_detected` INTEGER NULL;
