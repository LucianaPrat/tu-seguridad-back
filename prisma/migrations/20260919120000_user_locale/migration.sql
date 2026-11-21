-- AlterTable
ALTER TABLE `invitations` ADD COLUMN `locale` ENUM('es', 'en') NOT NULL DEFAULT 'es';

-- AlterTable
ALTER TABLE `users` ADD COLUMN `locale` ENUM('es', 'en') NOT NULL DEFAULT 'es';
