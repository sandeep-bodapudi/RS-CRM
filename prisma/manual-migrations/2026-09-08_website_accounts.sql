-- Safety header: generated via
--   npx prisma migrate diff --from-url <local test_db> --to-schema-datamodel prisma/schema.prisma --script
-- Purely additive: 4 new tables (WebsiteAccount, WebsiteShortlistItem,
-- WebsiteCompareItem, WebsiteActivityEvent), 0 ALTER on existing tables,
-- 0 DROP anything. Backs the public-website self-service account/
-- shortlist/compare/analytics feature — see the comment on WebsiteAccount
-- in schema.prisma for why this is deliberately separate from `Customer`.
-- apps/api/prisma/migrations/ is stale — do not use `prisma migrate dev`.

-- CreateTable
CREATE TABLE `WebsiteAccount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `full_name` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `token_version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `WebsiteAccount_company_id_idx`(`company_id`),
    UNIQUE INDEX `WebsiteAccount_company_id_email_key`(`company_id`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebsiteShortlistItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `property_id` INTEGER NULL,
    `project_unit_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebsiteShortlistItem_account_id_idx`(`account_id`),
    UNIQUE INDEX `WebsiteShortlistItem_account_id_property_id_key`(`account_id`, `property_id`),
    UNIQUE INDEX `WebsiteShortlistItem_account_id_project_unit_id_key`(`account_id`, `project_unit_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebsiteCompareItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `property_id` INTEGER NULL,
    `project_unit_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebsiteCompareItem_account_id_idx`(`account_id`),
    UNIQUE INDEX `WebsiteCompareItem_account_id_property_id_key`(`account_id`, `property_id`),
    UNIQUE INDEX `WebsiteCompareItem_account_id_project_unit_id_key`(`account_id`, `project_unit_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WebsiteActivityEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NOT NULL,
    `account_id` INTEGER NULL,
    `anonymous_id` VARCHAR(191) NULL,
    `event_name` VARCHAR(191) NOT NULL,
    `page` VARCHAR(191) NULL,
    `property_id` INTEGER NULL,
    `project_id` INTEGER NULL,
    `search_context` JSON NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `WebsiteActivityEvent_company_id_created_at_idx`(`company_id`, `created_at`),
    INDEX `WebsiteActivityEvent_account_id_idx`(`account_id`),
    INDEX `WebsiteActivityEvent_anonymous_id_idx`(`anonymous_id`),
    INDEX `WebsiteActivityEvent_event_name_idx`(`event_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `WebsiteAccount` ADD CONSTRAINT `WebsiteAccount_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebsiteShortlistItem` ADD CONSTRAINT `WebsiteShortlistItem_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `WebsiteAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebsiteShortlistItem` ADD CONSTRAINT `WebsiteShortlistItem_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebsiteShortlistItem` ADD CONSTRAINT `WebsiteShortlistItem_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebsiteCompareItem` ADD CONSTRAINT `WebsiteCompareItem_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `WebsiteAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebsiteCompareItem` ADD CONSTRAINT `WebsiteCompareItem_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebsiteCompareItem` ADD CONSTRAINT `WebsiteCompareItem_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebsiteActivityEvent` ADD CONSTRAINT `WebsiteActivityEvent_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WebsiteActivityEvent` ADD CONSTRAINT `WebsiteActivityEvent_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `WebsiteAccount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
