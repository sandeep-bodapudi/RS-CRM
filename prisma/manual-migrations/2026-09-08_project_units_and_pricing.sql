-- ============================================================================
-- Project Units & Pricing Engine
-- Generated 2026-09-08
--
-- Adds the ProjectUnit inventory model and the pricing/amenity tables that
-- support it, and wires project units into the sales pipeline alongside
-- standalone properties.
--
-- SAFETY: this migration is purely additive.
--   * 10 CREATE TABLE, 0 DROP TABLE, 0 DROP COLUMN.
--   * Every MODIFY is a NOT NULL -> NULL widening (property_id on booking,
--     leadpropertyinterest, sitevisitproperty, demointerestedproperty,
--     propertylayoutregion) so no existing row can fail or lose data.
--   * Every new NOT NULL column carries a DEFAULT, so existing rows backfill.
--
-- HOW TO APPLY
--   Local:      npx prisma db execute --url "$DATABASE_URL" --file apps/api/prisma/manual-migrations/2026-09-08_project_units_and_pricing.sql
--   Production: run the same command with DATABASE_URL_PRODUCTION, deliberately.
--
-- NOTE: apps/api/prisma/migrations/ is stale — replaying it rebuilds the whole
-- schema and drops 39 tables. This project is maintained with "prisma db push",
-- so schema changes are shipped as reviewed SQL files here instead. Do not run
-- "prisma migrate deploy" against production until that history is rebuilt.
-- ============================================================================
-- DropForeignKey
ALTER TABLE `booking` DROP FOREIGN KEY `Booking_property_id_fkey`;

-- AlterTable
ALTER TABLE `booking` ADD COLUMN `project_unit_id` INTEGER NULL,
    MODIFY `property_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `complaint` ADD COLUMN `project_unit_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `demointerestedproperty` ADD COLUMN `project_unit_id` INTEGER NULL,
    MODIFY `property_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `leadpropertyinterest` ADD COLUMN `project_unit_id` INTEGER NULL,
    MODIFY `property_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `opportunity` ADD COLUMN `project_unit_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `project` ADD COLUMN `address` TEXT NULL,
    ADD COLUMN `approval_authority` VARCHAR(191) NULL,
    ADD COLUMN `approval_number` VARCHAR(191) NULL,
    ADD COLUMN `blocks_count` INTEGER NULL,
    ADD COLUMN `city` VARCHAR(191) NULL,
    ADD COLUMN `completion_date` DATETIME(3) NULL,
    ADD COLUMN `cover_image_url` TEXT NULL,
    ADD COLUMN `default_area_unit` ENUM('SQFT', 'SQYD', 'SQM', 'ACRE', 'GUNTA', 'CENT', 'ANKANAM', 'HECTARE') NULL,
    ADD COLUMN `default_price_basis` ENUM('CARPET', 'BUILT_UP', 'SUPER_BUILT_UP', 'PLOT_AREA', 'LUMPSUM') NULL,
    ADD COLUMN `developer_name` VARCHAR(191) NULL,
    ADD COLUMN `district` VARCHAR(191) NULL,
    ADD COLUMN `floors_count` INTEGER NULL,
    ADD COLUMN `is_published` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `latitude` DOUBLE NULL,
    ADD COLUMN `locality` VARCHAR(191) NULL,
    ADD COLUMN `longitude` DOUBLE NULL,
    ADD COLUMN `lp_number` VARCHAR(191) NULL,
    ADD COLUMN `mandal` VARCHAR(191) NULL,
    ADD COLUMN `maps_link` TEXT NULL,
    ADD COLUMN `pincode` VARCHAR(191) NULL,
    ADD COLUMN `project_type` ENUM('PLOTTED', 'APARTMENT', 'VILLA', 'MIXED', 'COMMERCIAL') NULL,
    ADD COLUMN `rera_status` VARCHAR(191) NULL,
    ADD COLUMN `state` VARCHAR(191) NULL,
    ADD COLUMN `total_area_unit` ENUM('SQFT', 'SQYD', 'SQM', 'ACRE', 'GUNTA', 'CENT', 'ANKANAM', 'HECTARE') NULL,
    ADD COLUMN `total_area_value` DOUBLE NULL,
    ADD COLUMN `towers_count` INTEGER NULL,
    ADD COLUMN `village` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `property` ADD COLUMN `area_sqyd` DOUBLE NULL,
    ADD COLUMN `area_unit` ENUM('SQFT', 'SQYD', 'SQM', 'ACRE', 'GUNTA', 'CENT', 'ANKANAM', 'HECTARE') NULL,
    ADD COLUMN `area_value` DOUBLE NULL,
    ADD COLUMN `base_price` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `base_rate` DOUBLE NULL,
    ADD COLUMN `base_rate_unit` ENUM('FIXED', 'PER_SQFT', 'PER_SQYD', 'PERCENT_OF_BASE', 'QTY_X_RATE') NULL,
    ADD COLUMN `built_up_area_sqft` DOUBLE NULL,
    ADD COLUMN `calculated_price` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `carpet_area_sqft` DOUBLE NULL,
    ADD COLUMN `charges_total` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `construction_year` INTEGER NULL,
    ADD COLUMN `discount_amount` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `discount_reason` VARCHAR(191) NULL,
    ADD COLUMN `final_price` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `first_floor_area_sqft` DOUBLE NULL,
    ADD COLUMN `ground_floor_area_sqft` DOUBLE NULL,
    ADD COLUMN `held_for_lead_id` INTEGER NULL,
    ADD COLUMN `hold_until` DATETIME(3) NULL,
    ADD COLUMN `is_corner` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `is_main_road_facing` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `is_park_facing` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `is_road_facing` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `overridden_at` DATETIME(3) NULL,
    ADD COLUMN `overridden_by_id` INTEGER NULL,
    ADD COLUMN `override_price` DOUBLE NULL,
    ADD COLUMN `override_reason` TEXT NULL,
    ADD COLUMN `plot_area_sqyd` DOUBLE NULL,
    ADD COLUMN `plot_length_ft` DOUBLE NULL,
    ADD COLUMN `plot_width_ft` DOUBLE NULL,
    ADD COLUMN `premiums_total` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `price_basis` ENUM('CARPET', 'BUILT_UP', 'SUPER_BUILT_UP', 'PLOT_AREA', 'LUMPSUM') NOT NULL DEFAULT 'SUPER_BUILT_UP',
    ADD COLUMN `price_computed_at` DATETIME(3) NULL,
    ADD COLUMN `road_width_ft` DOUBLE NULL,
    ADD COLUMN `sales_status` ENUM('AVAILABLE', 'HOLD', 'RESERVED', 'BOOKED', 'SOLD', 'BLOCKED', 'UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE',
    ADD COLUMN `super_built_up_area_sqft` DOUBLE NULL,
    ADD COLUMN `taxes_total` DOUBLE NOT NULL DEFAULT 0,
    ADD COLUMN `total_floors` INTEGER NULL,
    ADD COLUMN `view` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `propertylayoutregion` ADD COLUMN `project_unit_id` INTEGER NULL,
    MODIFY `property_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `sitevisitbooking` ADD COLUMN `project_unit_id` INTEGER NULL;

-- AlterTable
ALTER TABLE `sitevisitproperty` ADD COLUMN `project_unit_id` INTEGER NULL,
    MODIFY `property_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `ProjectUnit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `unit_code` VARCHAR(191) NOT NULL,
    `project_id` INTEGER NOT NULL,
    `company_id` INTEGER NOT NULL,
    `branch_id` INTEGER NULL,
    `unit_number` VARCHAR(191) NOT NULL,
    `unit_type` ENUM('PLOT', 'FLAT', 'VILLA', 'HOUSE', 'COMMERCIAL', 'OTHER') NOT NULL,
    `plot_number` VARCHAR(191) NULL,
    `survey_number` VARCHAR(191) NULL,
    `tower` VARCHAR(191) NULL,
    `block` VARCHAR(191) NULL,
    `floor` INTEGER NULL,
    `flat_number` VARCHAR(191) NULL,
    `villa_number` VARCHAR(191) NULL,
    `type_code` VARCHAR(191) NULL,
    `bhk` VARCHAR(191) NULL,
    `bedrooms` INTEGER NULL,
    `bathrooms` INTEGER NULL,
    `balconies` INTEGER NULL,
    `living_rooms` INTEGER NULL,
    `kitchens` INTEGER NULL,
    `utility_rooms` INTEGER NULL,
    `has_pooja_room` BOOLEAN NOT NULL DEFAULT false,
    `has_study_room` BOOLEAN NOT NULL DEFAULT false,
    `area_value` DOUBLE NULL,
    `area_unit` ENUM('SQFT', 'SQYD', 'SQM', 'ACRE', 'GUNTA', 'CENT', 'ANKANAM', 'HECTARE') NULL,
    `area_sqft` DOUBLE NULL,
    `area_sqyd` DOUBLE NULL,
    `plot_area_sqyd` DOUBLE NULL,
    `plot_length_ft` DOUBLE NULL,
    `plot_width_ft` DOUBLE NULL,
    `carpet_area_sqft` DOUBLE NULL,
    `built_up_area_sqft` DOUBLE NULL,
    `super_built_up_area_sqft` DOUBLE NULL,
    `ground_floor_area_sqft` DOUBLE NULL,
    `first_floor_area_sqft` DOUBLE NULL,
    `total_floors` INTEGER NULL,
    `price_basis` ENUM('CARPET', 'BUILT_UP', 'SUPER_BUILT_UP', 'PLOT_AREA', 'LUMPSUM') NOT NULL DEFAULT 'SUPER_BUILT_UP',
    `facing` VARCHAR(191) NULL,
    `is_corner` BOOLEAN NOT NULL DEFAULT false,
    `is_road_facing` BOOLEAN NOT NULL DEFAULT false,
    `is_park_facing` BOOLEAN NOT NULL DEFAULT false,
    `is_main_road_facing` BOOLEAN NOT NULL DEFAULT false,
    `road_width_ft` DOUBLE NULL,
    `view` VARCHAR(191) NULL,
    `parking_included` BOOLEAN NOT NULL DEFAULT false,
    `parking_type` VARCHAR(191) NULL,
    `parking_count` INTEGER NULL,
    `parking_slots` VARCHAR(191) NULL,
    `base_rate` DOUBLE NULL,
    `base_rate_unit` ENUM('FIXED', 'PER_SQFT', 'PER_SQYD', 'PERCENT_OF_BASE', 'QTY_X_RATE') NULL,
    `base_price` DOUBLE NOT NULL DEFAULT 0,
    `premiums_total` DOUBLE NOT NULL DEFAULT 0,
    `charges_total` DOUBLE NOT NULL DEFAULT 0,
    `taxes_total` DOUBLE NOT NULL DEFAULT 0,
    `discount_amount` DOUBLE NOT NULL DEFAULT 0,
    `discount_reason` VARCHAR(191) NULL,
    `calculated_price` DOUBLE NOT NULL DEFAULT 0,
    `override_price` DOUBLE NULL,
    `override_reason` TEXT NULL,
    `overridden_by_id` INTEGER NULL,
    `overridden_at` DATETIME(3) NULL,
    `final_price` DOUBLE NOT NULL DEFAULT 0,
    `price_computed_at` DATETIME(3) NULL,
    `sales_status` ENUM('AVAILABLE', 'HOLD', 'RESERVED', 'BOOKED', 'SOLD', 'BLOCKED', 'UNAVAILABLE') NOT NULL DEFAULT 'AVAILABLE',
    `hold_until` DATETIME(3) NULL,
    `held_for_lead_id` INTEGER NULL,
    `locked_until` DATETIME(3) NULL,
    `locked_by_booking_id` INTEGER NULL,
    `is_published` BOOLEAN NOT NULL DEFAULT false,
    `notes` TEXT NULL,
    `created_by_id` INTEGER NULL,
    `migrated_from_property_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProjectUnit_unit_code_key`(`unit_code`),
    UNIQUE INDEX `ProjectUnit_locked_by_booking_id_key`(`locked_by_booking_id`),
    INDEX `ProjectUnit_project_id_sales_status_idx`(`project_id`, `sales_status`),
    INDEX `ProjectUnit_project_id_unit_type_idx`(`project_id`, `unit_type`),
    INDEX `ProjectUnit_project_id_tower_floor_idx`(`project_id`, `tower`, `floor`),
    INDEX `ProjectUnit_project_id_bhk_idx`(`project_id`, `bhk`),
    INDEX `ProjectUnit_company_id_idx`(`company_id`),
    INDEX `ProjectUnit_final_price_idx`(`final_price`),
    INDEX `ProjectUnit_area_sqft_idx`(`area_sqft`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectPricingRule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `kind` ENUM('BASE_RATE', 'PREMIUM', 'CHARGE', 'DISCOUNT', 'TAX') NOT NULL,
    `category` ENUM('FACING', 'FLOOR', 'CORNER', 'ROAD', 'PARK', 'VIEW', 'BHK', 'AMENITY', 'PARKING', 'INFRA', 'MAINTENANCE', 'LEGAL', 'CLUB', 'TAX', 'OTHER') NOT NULL,
    `calc_method` ENUM('FIXED', 'PER_SQFT', 'PER_SQYD', 'PERCENT_OF_BASE', 'QTY_X_RATE') NOT NULL,
    `rate` DOUBLE NOT NULL,
    `area_basis` ENUM('CARPET', 'BUILT_UP', 'SUPER_BUILT_UP', 'PLOT_AREA', 'LUMPSUM') NULL,
    `applies_to_unit_type` ENUM('PLOT', 'FLAT', 'VILLA', 'HOUSE', 'COMMERCIAL', 'OTHER') NULL,
    `is_mandatory` BOOLEAN NOT NULL DEFAULT true,
    `is_tax` BOOLEAN NOT NULL DEFAULT false,
    `is_refundable` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `match_facing` VARCHAR(191) NULL,
    `match_corner` BOOLEAN NULL,
    `match_park_facing` BOOLEAN NULL,
    `match_road_facing` BOOLEAN NULL,
    `match_main_road_facing` BOOLEAN NULL,
    `match_floor_min` INTEGER NULL,
    `match_floor_max` INTEGER NULL,
    `match_bhk` VARCHAR(191) NULL,
    `match_type_code` VARCHAR(191) NULL,
    `match_view` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ProjectPricingRule_project_id_kind_idx`(`project_id`, `kind`),
    INDEX `ProjectPricingRule_project_id_is_active_idx`(`project_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PriceLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_unit_id` INTEGER NULL,
    `property_id` INTEGER NULL,
    `rule_id` INTEGER NULL,
    `label` VARCHAR(191) NOT NULL,
    `kind` ENUM('BASE_RATE', 'PREMIUM', 'CHARGE', 'DISCOUNT', 'TAX') NOT NULL,
    `category` ENUM('FACING', 'FLOOR', 'CORNER', 'ROAD', 'PARK', 'VIEW', 'BHK', 'AMENITY', 'PARKING', 'INFRA', 'MAINTENANCE', 'LEGAL', 'CLUB', 'TAX', 'OTHER') NOT NULL,
    `calc_method` ENUM('FIXED', 'PER_SQFT', 'PER_SQYD', 'PERCENT_OF_BASE', 'QTY_X_RATE') NOT NULL,
    `rate` DOUBLE NOT NULL,
    `quantity` DOUBLE NOT NULL DEFAULT 1,
    `area_basis` ENUM('CARPET', 'BUILT_UP', 'SUPER_BUILT_UP', 'PLOT_AREA', 'LUMPSUM') NULL,
    `amount` DOUBLE NOT NULL,
    `is_manual` BOOLEAN NOT NULL DEFAULT false,
    `is_refundable` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PriceLine_project_unit_id_idx`(`project_unit_id`),
    INDEX `PriceLine_property_id_idx`(`property_id`),
    INDEX `PriceLine_rule_id_idx`(`rule_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Amenity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `category` ENUM('SECURITY', 'RECREATION', 'CONVENIENCE', 'ENVIRONMENT', 'SPORTS', 'UTILITY', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `Amenity_company_id_idx`(`company_id`),
    UNIQUE INDEX `Amenity_company_id_name_key`(`company_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectAmenity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `amenity_id` INTEGER NOT NULL,
    `availability` ENUM('INCLUDED', 'OPTIONAL', 'CHARGEABLE') NOT NULL DEFAULT 'INCLUDED',
    `charge_calc_method` ENUM('FIXED', 'PER_SQFT', 'PER_SQYD', 'PERCENT_OF_BASE', 'QTY_X_RATE') NULL,
    `charge_amount` DOUBLE NULL,
    `applicability` ENUM('ALL_UNITS', 'SELECTED_UNITS', 'BY_UNIT_TYPE') NOT NULL DEFAULT 'ALL_UNITS',
    `applicable_unit_type` ENUM('PLOT', 'FLAT', 'VILLA', 'HOUSE', 'COMMERCIAL', 'OTHER') NULL,
    `notes` VARCHAR(191) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ProjectAmenity_project_id_idx`(`project_id`),
    UNIQUE INDEX `ProjectAmenity_project_id_amenity_id_key`(`project_id`, `amenity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryFeature` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_unit_id` INTEGER NULL,
    `property_id` INTEGER NULL,
    `amenity_id` INTEGER NULL,
    `label` VARCHAR(191) NOT NULL,
    `charge_amount` DOUBLE NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InventoryFeature_project_unit_id_idx`(`project_unit_id`),
    INDEX `InventoryFeature_property_id_idx`(`property_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectMedia` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `kind` ENUM('COVER', 'GALLERY', 'VIDEO', 'BROCHURE', 'MASTER_PLAN', 'LAYOUT_PLAN', 'FLOOR_PLAN') NOT NULL,
    `url` TEXT NOT NULL,
    `title` VARCHAR(191) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `uploaded_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectMedia_project_id_kind_idx`(`project_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `kind` ENUM('RERA', 'APPROVAL', 'LEGAL', 'OTHER') NOT NULL DEFAULT 'OTHER',
    `url` TEXT NOT NULL,
    `title` VARCHAR(191) NULL,
    `uploaded_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectDocument_project_id_kind_idx`(`project_id`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectUnitImage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_unit_id` INTEGER NOT NULL,
    `image_url` TEXT NOT NULL,
    `alt_text` VARCHAR(191) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `uploaded_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectUnitImage_project_unit_id_idx`(`project_unit_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProjectUnitDocument` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_unit_id` INTEGER NOT NULL,
    `url` TEXT NOT NULL,
    `title` VARCHAR(191) NULL,
    `uploaded_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectUnitDocument_project_unit_id_idx`(`project_unit_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Booking_project_unit_id_idx` ON `Booking`(`project_unit_id`);

-- CreateIndex
CREATE INDEX `DemoInterestedProperty_project_unit_id_idx` ON `DemoInterestedProperty`(`project_unit_id`);

-- CreateIndex
CREATE UNIQUE INDEX `DemoInterestedProperty_demo_id_project_unit_id_key` ON `DemoInterestedProperty`(`demo_id`, `project_unit_id`);

-- CreateIndex
CREATE INDEX `LeadPropertyInterest_project_unit_id_idx` ON `LeadPropertyInterest`(`project_unit_id`);

-- CreateIndex
CREATE UNIQUE INDEX `LeadPropertyInterest_lead_id_project_unit_id_key` ON `LeadPropertyInterest`(`lead_id`, `project_unit_id`);

-- CreateIndex
CREATE INDEX `Project_project_type_idx` ON `Project`(`project_type`);

-- CreateIndex
CREATE INDEX `Project_city_idx` ON `Project`(`city`);

-- CreateIndex
CREATE INDEX `PropertyLayoutRegion_project_unit_id_idx` ON `PropertyLayoutRegion`(`project_unit_id`);

-- CreateIndex
CREATE UNIQUE INDEX `PropertyLayoutRegion_layout_image_id_project_unit_id_key` ON `PropertyLayoutRegion`(`layout_image_id`, `project_unit_id`);

-- CreateIndex
CREATE INDEX `SiteVisitProperty_project_unit_id_idx` ON `SiteVisitProperty`(`project_unit_id`);

-- CreateIndex
CREATE UNIQUE INDEX `SiteVisitProperty_visit_id_project_unit_id_key` ON `SiteVisitProperty`(`visit_id`, `project_unit_id`);

-- AddForeignKey
ALTER TABLE `LeadPropertyInterest` ADD CONSTRAINT `LeadPropertyInterest_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnit` ADD CONSTRAINT `ProjectUnit_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnit` ADD CONSTRAINT `ProjectUnit_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnit` ADD CONSTRAINT `ProjectUnit_branch_id_fkey` FOREIGN KEY (`branch_id`) REFERENCES `Branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnit` ADD CONSTRAINT `ProjectUnit_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnit` ADD CONSTRAINT `ProjectUnit_overridden_by_id_fkey` FOREIGN KEY (`overridden_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnit` ADD CONSTRAINT `ProjectUnit_locked_by_booking_id_fkey` FOREIGN KEY (`locked_by_booking_id`) REFERENCES `Booking`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectPricingRule` ADD CONSTRAINT `ProjectPricingRule_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PriceLine` ADD CONSTRAINT `PriceLine_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PriceLine` ADD CONSTRAINT `PriceLine_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PriceLine` ADD CONSTRAINT `PriceLine_rule_id_fkey` FOREIGN KEY (`rule_id`) REFERENCES `ProjectPricingRule`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Amenity` ADD CONSTRAINT `Amenity_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `Company`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectAmenity` ADD CONSTRAINT `ProjectAmenity_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectAmenity` ADD CONSTRAINT `ProjectAmenity_amenity_id_fkey` FOREIGN KEY (`amenity_id`) REFERENCES `Amenity`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryFeature` ADD CONSTRAINT `InventoryFeature_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryFeature` ADD CONSTRAINT `InventoryFeature_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryFeature` ADD CONSTRAINT `InventoryFeature_amenity_id_fkey` FOREIGN KEY (`amenity_id`) REFERENCES `Amenity`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectMedia` ADD CONSTRAINT `ProjectMedia_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectMedia` ADD CONSTRAINT `ProjectMedia_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectDocument` ADD CONSTRAINT `ProjectDocument_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectDocument` ADD CONSTRAINT `ProjectDocument_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnitImage` ADD CONSTRAINT `ProjectUnitImage_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnitImage` ADD CONSTRAINT `ProjectUnitImage_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnitDocument` ADD CONSTRAINT `ProjectUnitDocument_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectUnitDocument` ADD CONSTRAINT `ProjectUnitDocument_uploaded_by_id_fkey` FOREIGN KEY (`uploaded_by_id`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyLayoutRegion` ADD CONSTRAINT `PropertyLayoutRegion_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SiteVisitBooking` ADD CONSTRAINT `SiteVisitBooking_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SiteVisitProperty` ADD CONSTRAINT `SiteVisitProperty_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Complaint` ADD CONSTRAINT `Complaint_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Booking` ADD CONSTRAINT `Booking_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Opportunity` ADD CONSTRAINT `Opportunity_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DemoInterestedProperty` ADD CONSTRAINT `DemoInterestedProperty_project_unit_id_fkey` FOREIGN KEY (`project_unit_id`) REFERENCES `ProjectUnit`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

