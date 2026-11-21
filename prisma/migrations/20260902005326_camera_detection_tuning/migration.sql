-- AlterTable
ALTER TABLE `cameras` ADD COLUMN `confidence_threshold` DECIMAL(4, 3) NULL,
    ADD COLUMN `min_poll_seconds` INTEGER NULL;
