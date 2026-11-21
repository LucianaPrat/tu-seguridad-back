-- The setup-era product tables are replaced wholesale, not converted: polygons do not map to
-- percentage rectangles, cameras gain a mandatory DVR owner, and users gain mandatory profile
-- columns. Altering them in place would backfill '' into `cameras.dvr_id`/`external_id` and into
-- the new `users` name/phone columns, and the unique index below would then abort the migration
-- half-applied (MySQL DDL is not transactional). Production holds no data — see
-- plans/03.tenant-alert-data-model.tasks.md, "Migration safety (T01)". `hits` is technical
-- telemetry and is left untouched.

-- DropTable
DROP TABLE `zone_events`;

-- DropTable
DROP TABLE `zones`;

-- DropTable
DROP TABLE `cameras`;

-- DropTable
DROP TABLE `users`;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `first_name` VARCHAR(191) NOT NULL,
    `last_name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `avatar_url` VARCHAR(191) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `profile_completed` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `spaces` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `owner_user_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `spaces_owner_user_id_key`(`owner_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `space_members` (
    `id` VARCHAR(191) NOT NULL,
    `space_id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `role` ENUM('admin', 'member') NOT NULL DEFAULT 'member',
    `receive_alerts` BOOLEAN NOT NULL DEFAULT true,
    `invited_by_user_id` INTEGER NULL,
    `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `space_members_user_id_key`(`user_id`),
    INDEX `space_members_space_id_idx`(`space_id`),
    UNIQUE INDEX `space_members_space_id_user_id_key`(`space_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invitations` (
    `id` VARCHAR(191) NOT NULL,
    `space_id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `invited_by_user_id` INTEGER NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `created_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invitations_token_hash_key`(`token_hash`),
    INDEX `invitations_space_id_email_idx`(`space_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `purpose` ENUM('refresh', 'magic_link', 'password_reset') NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `rotated_from_id` VARCHAR(191) NULL,
    `user_agent` VARCHAR(191) NULL,
    `ip` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_tokens_token_hash_key`(`token_hash`),
    INDEX `auth_tokens_user_id_purpose_idx`(`user_id`, `purpose`),
    INDEX `auth_tokens_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_face_identities` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(191) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `user_face_identities_token_hash_key`(`token_hash`),
    INDEX `user_face_identities_user_id_is_active_idx`(`user_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dvrs` (
    `id` VARCHAR(191) NOT NULL,
    `space_id` VARCHAR(191) NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password_encrypted` VARCHAR(512) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL,
    `last_test_at` DATETIME(3) NULL,
    `last_test_ok` BOOLEAN NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `dvrs_space_id_key`(`space_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `cameras` (
    `id` VARCHAR(191) NOT NULL,
    `dvr_id` VARCHAR(191) NOT NULL,
    `external_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `status` ENUM('online', 'offline') NOT NULL DEFAULT 'offline',
    `is_configured` BOOLEAN NOT NULL DEFAULT false,
    `is_enabled` BOOLEAN NOT NULL DEFAULT true,
    `monitor_mode` ENUM('full', 'partial') NOT NULL DEFAULT 'full',
    `alert_type` ENUM('intruder', 'suspicious') NULL,
    `last_snapshot_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `cameras_dvr_id_deleted_at_idx`(`dvr_id`, `deleted_at`),
    UNIQUE INDEX `cameras_dvr_id_external_id_key`(`dvr_id`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `monitor_zones` (
    `id` VARCHAR(191) NOT NULL,
    `camera_id` VARCHAR(191) NOT NULL,
    `x` DECIMAL(5, 2) NOT NULL,
    `y` DECIMAL(5, 2) NOT NULL,
    `width` DECIMAL(5, 2) NOT NULL,
    `height` DECIMAL(5, 2) NOT NULL,
    `alert_type` ENUM('intruder', 'suspicious') NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `monitor_zones_camera_id_deleted_at_idx`(`camera_id`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `snapshots` (
    `id` VARCHAR(191) NOT NULL,
    `camera_id` VARCHAR(191) NOT NULL,
    `data` MEDIUMBLOB NOT NULL,
    `mime_type` VARCHAR(191) NOT NULL,
    `byte_size` INTEGER NOT NULL,
    `sha256` VARCHAR(191) NOT NULL,
    `captured_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `snapshots_camera_id_captured_at_idx`(`camera_id`, `captured_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `alert_routings` (
    `id` VARCHAR(191) NOT NULL,
    `space_id` VARCHAR(191) NOT NULL,
    `alert_type` ENUM('intruder', 'suspicious') NOT NULL,
    `channel` ENUM('call', 'whatsapp', 'email') NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `alert_routings_space_id_alert_type_channel_key`(`space_id`, `alert_type`, `channel`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `alert_events` (
    `id` VARCHAR(191) NOT NULL,
    `space_id` VARCHAR(191) NOT NULL,
    `camera_id` VARCHAR(191) NULL,
    `zone_id` VARCHAR(191) NULL,
    `camera_label_snapshot` VARCHAR(191) NOT NULL,
    `alert_type` ENUM('intruder', 'suspicious') NOT NULL,
    `detected_at` DATETIME(3) NOT NULL,
    `snapshot_id` VARCHAR(191) NULL,
    `acknowledged_at` DATETIME(3) NULL,
    `acknowledged_by_user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `alert_events_space_id_detected_at_idx`(`space_id`, `detected_at` DESC),
    INDEX `alert_events_space_id_alert_type_detected_at_idx`(`space_id`, `alert_type`, `detected_at` DESC),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_deliveries` (
    `id` VARCHAR(191) NOT NULL,
    `event_id` VARCHAR(191) NOT NULL,
    `channel` ENUM('call', 'whatsapp', 'email') NOT NULL,
    `recipient_user_id` INTEGER NOT NULL,
    `status` ENUM('pending', 'sent', 'failed', 'delivered') NOT NULL DEFAULT 'pending',
    `correlation_id` VARCHAR(191) NOT NULL,
    `sent_at` DATETIME(3) NULL,
    `delivered_at` DATETIME(3) NULL,
    `provider_message_id` VARCHAR(191) NULL,
    `error` TEXT NULL,
    `inbound_received_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `event_deliveries_correlation_id_key`(`correlation_id`),
    UNIQUE INDEX `event_deliveries_provider_message_id_key`(`provider_message_id`),
    INDEX `event_deliveries_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `spaces` ADD CONSTRAINT `spaces_owner_user_id_fkey` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `space_members` ADD CONSTRAINT `space_members_space_id_fkey` FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `space_members` ADD CONSTRAINT `space_members_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `space_members` ADD CONSTRAINT `space_members_invited_by_user_id_fkey` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_space_id_fkey` FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_invited_by_user_id_fkey` FOREIGN KEY (`invited_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invitations` ADD CONSTRAINT `invitations_created_user_id_fkey` FOREIGN KEY (`created_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_rotated_from_id_fkey` FOREIGN KEY (`rotated_from_id`) REFERENCES `auth_tokens`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_face_identities` ADD CONSTRAINT `user_face_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dvrs` ADD CONSTRAINT `dvrs_space_id_fkey` FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cameras` ADD CONSTRAINT `cameras_dvr_id_fkey` FOREIGN KEY (`dvr_id`) REFERENCES `dvrs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `monitor_zones` ADD CONSTRAINT `monitor_zones_camera_id_fkey` FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `snapshots` ADD CONSTRAINT `snapshots_camera_id_fkey` FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_routings` ADD CONSTRAINT `alert_routings_space_id_fkey` FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_events` ADD CONSTRAINT `alert_events_space_id_fkey` FOREIGN KEY (`space_id`) REFERENCES `spaces`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_events` ADD CONSTRAINT `alert_events_camera_id_fkey` FOREIGN KEY (`camera_id`) REFERENCES `cameras`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_events` ADD CONSTRAINT `alert_events_zone_id_fkey` FOREIGN KEY (`zone_id`) REFERENCES `monitor_zones`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_events` ADD CONSTRAINT `alert_events_snapshot_id_fkey` FOREIGN KEY (`snapshot_id`) REFERENCES `snapshots`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `alert_events` ADD CONSTRAINT `alert_events_acknowledged_by_user_id_fkey` FOREIGN KEY (`acknowledged_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_deliveries` ADD CONSTRAINT `event_deliveries_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `alert_events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_deliveries` ADD CONSTRAINT `event_deliveries_recipient_user_id_fkey` FOREIGN KEY (`recipient_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Monitor-zone rectangles are percentages. Prisma models the decimal shape but MySQL enforces
-- the cross-column geometry invariant that a single field validator cannot represent.
ALTER TABLE `monitor_zones`
    ADD CONSTRAINT `monitor_zones_rectangle_bounds_check`
    CHECK (
        `x` >= 0 AND `y` >= 0 AND
        `width` > 0 AND `height` > 0 AND
        `x` + `width` <= 100 AND `y` + `height` <= 100
    );
