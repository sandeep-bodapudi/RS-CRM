-- CreateTable
CREATE TABLE `ProjectLayoutImage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `image_url` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `uploaded_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ProjectLayoutImage_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PropertyLayoutRegion` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `layout_image_id` INTEGER NOT NULL,
    `property_id` INTEGER NOT NULL,
    `x` DOUBLE NOT NULL,
    `y` DOUBLE NOT NULL,
    `created_by_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `PropertyLayoutRegion_property_id_idx`(`property_id`),
    UNIQUE INDEX `PropertyLayoutRegion_layout_image_id_property_id_key`(`layout_image_id`, `property_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectLayoutImage` ADD CONSTRAINT `ProjectLayoutImage_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectLayoutImage` ADD CONSTRAINT `ProjectLayoutImage_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyLayoutRegion` ADD CONSTRAINT `PropertyLayoutRegion_layout_image_id_fkey` FOREIGN KEY (`layout_image_id`) REFERENCES `ProjectLayoutImage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyLayoutRegion` ADD CONSTRAINT `PropertyLayoutRegion_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyLayoutRegion` ADD CONSTRAINT `PropertyLayoutRegion_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `Employee`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

