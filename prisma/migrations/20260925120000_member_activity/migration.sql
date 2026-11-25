-- CreateTable
CREATE TABLE `login_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `method` ENUM('password', 'magic_link', 'face') NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_events_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `login_events_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stream_watch_minutes` (
    `space_id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `camera_id` VARCHAR(191) NOT NULL,
    `minute` DATETIME(3) NOT NULL,

    INDEX `stream_watch_minutes_space_id_minute_idx`(`space_id`, `minute`),
    PRIMARY KEY (`space_id`, `user_id`, `camera_id`, `minute`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `login_events` ADD CONSTRAINT `login_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

