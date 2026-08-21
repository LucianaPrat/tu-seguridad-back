-- AlterTable
ALTER TABLE `snapshots` ADD COLUMN `is_live` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `snapshots_camera_id_is_live_idx` ON `snapshots`(`camera_id`, `is_live`);
