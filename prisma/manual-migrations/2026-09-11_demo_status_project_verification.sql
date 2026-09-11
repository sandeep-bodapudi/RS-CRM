-- AlterTable: Demo - add status, accepted_at, accepted_by
ALTER TABLE `Demo` ADD COLUMN `accepted_at` DATETIME(3) NULL,
    ADD COLUMN `accepted_by` INTEGER NULL,
    ADD COLUMN `status` VARCHAR(191) NOT NULL DEFAULT 'PENDING';

-- AlterTable: Project - add verification fields
ALTER TABLE `Project` ADD COLUMN `verification_notes` TEXT NULL,
    ADD COLUMN `verification_status` VARCHAR(191) NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `verified_at` DATETIME(3) NULL,
    ADD COLUMN `verified_by_id` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_verified_by_id_fkey` FOREIGN KEY (`verified_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
