-- AlterTable
ALTER TABLE `lead` ADD COLUMN `external_agent_associate_id` VARCHAR(191) NULL,
    ADD COLUMN `external_agent_company` VARCHAR(191) NULL,
    ADD COLUMN `external_agent_name` VARCHAR(191) NULL,
    ADD COLUMN `external_agent_phone` VARCHAR(191) NULL;
