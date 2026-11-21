-- A user may belong to many spaces: lift the one-membership-per-user and
-- one-space-per-owner limits, and store role, permissions and invitation metadata.

-- space_members: MySQL needs an index for the user_id FK, so the plain index goes
-- in BEFORE the unique one is dropped.
CREATE INDEX `space_members_user_id_idx` ON `space_members`(`user_id`);
DROP INDEX `space_members_user_id_key` ON `space_members`;

-- Role enum: member -> collaborator, add guest. Widen, convert, narrow.
ALTER TABLE `space_members`
    MODIFY `role` ENUM('admin', 'member', 'collaborator', 'guest') NOT NULL DEFAULT 'member';
UPDATE `space_members` SET `role` = 'collaborator' WHERE `role` = 'member';
ALTER TABLE `space_members`
    MODIFY `role` ENUM('admin', 'collaborator', 'guest') NOT NULL DEFAULT 'collaborator';

-- Per-membership permissions: add as NULL, backfill, then make NOT NULL.
ALTER TABLE `space_members`
    ADD COLUMN `menu_access` JSON NULL,
    ADD COLUMN `camera_ids` JSON NULL;
UPDATE `space_members`
    SET `menu_access` = CASE `role`
            WHEN 'admin' THEN JSON_ARRAY('home', 'monitor', 'events', 'dvr', 'channels', 'members')
            ELSE JSON_ARRAY('home', 'monitor', 'events', 'dvr', 'channels')
        END,
        `camera_ids` = JSON_ARRAY();
ALTER TABLE `space_members`
    MODIFY `menu_access` JSON NOT NULL,
    MODIFY `camera_ids` JSON NOT NULL;

-- spaces: owner_user_id -> created_by_user_id (data kept, no longer unique).
ALTER TABLE `spaces` DROP FOREIGN KEY `spaces_owner_user_id_fkey`;
ALTER TABLE `spaces` RENAME COLUMN `owner_user_id` TO `created_by_user_id`;
CREATE INDEX `spaces_created_by_user_id_idx` ON `spaces`(`created_by_user_id`);
DROP INDEX `spaces_owner_user_id_key` ON `spaces`;
ALTER TABLE `spaces` ADD CONSTRAINT `spaces_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- users: last active space (no FK, validated against memberships when read).
ALTER TABLE `users` ADD COLUMN `last_space_id` VARCHAR(191) NULL;

-- invitations: role, permissions and lifecycle timestamps.
ALTER TABLE `invitations`
    ADD COLUMN `role` ENUM('admin', 'collaborator', 'guest') NOT NULL DEFAULT 'collaborator',
    ADD COLUMN `menu_access` JSON NULL,
    ADD COLUMN `camera_ids` JSON NULL,
    ADD COLUMN `declined_at` DATETIME(3) NULL,
    ADD COLUMN `revoked_at` DATETIME(3) NULL;
