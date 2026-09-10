-- ============================================================================
-- Property Category-Specific Details (per property details.md spec)
-- Generated 2026-09-08
--
-- Adds the 5 missing per-category detail sub-tables (Villa/House/Commercial
-- Shop/Commercial Office/Farm Land) that mirror the existing
-- PropertyPlotDetails/PropertyApartmentDetails pattern, so every one of the
-- 7 property types in the spec finally has its own real fields instead of
-- all types sharing one generic field set. Also extends PropertyPlotDetails
-- (near_park) and PropertyApartmentDetails (views/parking/construction
-- fields the spec calls for that were missing), and adds
-- Property.is_premium_location (a boolean that recurs identically across
-- every category, so it lives once on the base table).
--
-- SAFETY: purely additive.
--   * 5 CREATE TABLE, 0 DROP TABLE, 0 DROP COLUMN, 0 MODIFY COLUMN.
--   * Every new column is nullable or has a DEFAULT, so existing rows are untouched.
--
-- HOW TO APPLY
--   Local:      run via a small node/Prisma script against $DATABASE_URL (see
--               apps/api's convention — `npx prisma db execute` had issues in
--               this environment; a `$executeRawUnsafe` script worked instead).
--   Production: run the same statements against DATABASE_URL_PRODUCTION, deliberately.
--
-- NOTE: apps/api/prisma/migrations/ is stale — do not run `prisma migrate deploy`/`dev`.
-- This file was generated via `prisma migrate diff --from-url` against the live
-- local database.
-- ============================================================================

-- AlterTable
ALTER TABLE `property` ADD COLUMN `is_premium_location` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `propertyapartmentdetails` ADD COLUMN `balcony_area` DOUBLE NULL,
    ADD COLUMN `bathroom_type` VARCHAR(191) NULL,
    ADD COLUMN `electrical` VARCHAR(191) NULL,
    ADD COLUMN `fixtures` VARCHAR(191) NULL,
    ADD COLUMN `has_additional_parking` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `has_utility_area` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_city_view` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_covered_parking` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_garden_view` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_higher_floor` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_main_road_view` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_near_lift` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_near_staircase` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_pool_view` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `is_road_view` BOOLEAN NULL DEFAULT false,
    ADD COLUMN `paint` VARCHAR(191) NULL,
    ADD COLUMN `parking_number` VARCHAR(191) NULL,
    ADD COLUMN `plumbing` VARCHAR(191) NULL,
    ADD COLUMN `terrace_area` DOUBLE NULL;

-- AlterTable
ALTER TABLE `propertyplotdetails` ADD COLUMN `near_park` BOOLEAN NULL DEFAULT false;

-- CreateTable
CREATE TABLE `PropertyVillaDetails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `property_id` INTEGER NOT NULL,
    `villa_number` VARCHAR(191) NULL,
    `villa_type` VARCHAR(191) NULL,
    `bhk` VARCHAR(191) NULL,
    `has_second_floor` BOOLEAN NULL DEFAULT false,
    `second_floor_area` DOUBLE NULL,
    `has_servant_room` BOOLEAN NULL DEFAULT false,
    `has_pooja_room` BOOLEAN NULL DEFAULT false,
    `has_study_room` BOOLEAN NULL DEFAULT false,
    `has_family_room` BOOLEAN NULL DEFAULT false,
    `garden_area` DOUBLE NULL,
    `terrace_area` DOUBLE NULL,
    `is_clubhouse_facing` BOOLEAN NULL DEFAULT false,
    `is_pool_facing` BOOLEAN NULL DEFAULT false,
    `has_private_garden` BOOLEAN NULL DEFAULT false,
    `has_private_pool` BOOLEAN NULL DEFAULT false,
    `has_terrace` BOOLEAN NULL DEFAULT false,
    `has_compound_wall` BOOLEAN NULL DEFAULT false,
    `has_gate` BOOLEAN NULL DEFAULT false,
    `number_of_cars` INTEGER NULL,
    `has_ev_charging` BOOLEAN NULL DEFAULT false,

    UNIQUE INDEX `PropertyVillaDetails_property_id_key`(`property_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PropertyHouseDetails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `property_id` INTEGER NOT NULL,
    `house_number` VARCHAR(191) NULL,
    `house_type` VARCHAR(191) NULL,
    `bhk` VARCHAR(191) NULL,
    `has_kitchen` BOOLEAN NULL DEFAULT false,
    `has_pooja_room` BOOLEAN NULL DEFAULT false,
    `has_study_room` BOOLEAN NULL DEFAULT false,
    `has_servant_room` BOOLEAN NULL DEFAULT false,
    `has_utility_room` BOOLEAN NULL DEFAULT false,
    `garden_area` DOUBLE NULL,
    `terrace_area` DOUBLE NULL,
    `is_covered_parking` BOOLEAN NULL DEFAULT false,
    `parking_capacity` INTEGER NULL,
    `parking_number` VARCHAR(191) NULL,
    `has_additional_parking` BOOLEAN NULL DEFAULT false,

    UNIQUE INDEX `PropertyHouseDetails_property_id_key`(`property_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PropertyCommercialShopDetails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `property_id` INTEGER NOT NULL,
    `shop_number` VARCHAR(191) NULL,
    `building` VARCHAR(191) NULL,
    `block` VARCHAR(191) NULL,
    `floor` VARCHAR(191) NULL,
    `shop_type` VARCHAR(191) NULL,
    `frontage` DOUBLE NULL,
    `depth` DOUBLE NULL,
    `ceiling_height` DOUBLE NULL,
    `is_mall_facing` BOOLEAN NULL DEFAULT false,
    `is_entrance_facing` BOOLEAN NULL DEFAULT false,
    `is_parking_facing` BOOLEAN NULL DEFAULT false,
    `is_high_footfall_location` BOOLEAN NULL DEFAULT false,
    `has_parking` BOOLEAN NULL DEFAULT false,
    `has_power` BOOLEAN NULL DEFAULT false,
    `has_water` BOOLEAN NULL DEFAULT false,
    `has_washroom` BOOLEAN NULL DEFAULT false,
    `has_lift` BOOLEAN NULL DEFAULT false,
    `has_security` BOOLEAN NULL DEFAULT false,
    `has_fire_safety` BOOLEAN NULL DEFAULT false,
    `has_signage_space` BOOLEAN NULL DEFAULT false,

    UNIQUE INDEX `PropertyCommercialShopDetails_property_id_key`(`property_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PropertyCommercialOfficeDetails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `property_id` INTEGER NOT NULL,
    `office_number` VARCHAR(191) NULL,
    `tower` VARCHAR(191) NULL,
    `floor` VARCHAR(191) NULL,
    `block` VARCHAR(191) NULL,
    `office_type` VARCHAR(191) NULL,
    `cabins` INTEGER NULL,
    `workstations` INTEGER NULL,
    `meeting_rooms` INTEGER NULL,
    `has_reception` BOOLEAN NULL DEFAULT false,
    `has_pantry` BOOLEAN NULL DEFAULT false,
    `washrooms` INTEGER NULL,
    `has_server_room` BOOLEAN NULL DEFAULT false,
    `is_city_view` BOOLEAN NULL DEFAULT false,
    `is_higher_floor` BOOLEAN NULL DEFAULT false,
    `has_parking` BOOLEAN NULL DEFAULT false,
    `has_power_backup` BOOLEAN NULL DEFAULT false,
    `has_lift` BOOLEAN NULL DEFAULT false,
    `has_security` BOOLEAN NULL DEFAULT false,
    `has_fire_safety` BOOLEAN NULL DEFAULT false,
    `has_hvac` BOOLEAN NULL DEFAULT false,
    `has_internet` BOOLEAN NULL DEFAULT false,
    `has_ev_charging` BOOLEAN NULL DEFAULT false,

    UNIQUE INDEX `PropertyCommercialOfficeDetails_property_id_key`(`property_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PropertyFarmLandDetails` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `property_id` INTEGER NOT NULL,
    `farm_land_number` VARCHAR(191) NULL,
    `parcel_number` VARCHAR(191) NULL,
    `survey_number` VARCHAR(191) NULL,
    `subdivision` VARCHAR(191) NULL,
    `road_frontage` DOUBLE NULL,
    `boundary_details` TEXT NULL,
    `is_near_water_source` BOOLEAN NULL DEFAULT false,
    `has_internal_road` BOOLEAN NULL DEFAULT false,
    `has_electricity` BOOLEAN NULL DEFAULT false,
    `has_water` BOOLEAN NULL DEFAULT false,
    `has_borewell` BOOLEAN NULL DEFAULT false,
    `has_irrigation` BOOLEAN NULL DEFAULT false,
    `has_fencing` BOOLEAN NULL DEFAULT false,
    `has_plantation` BOOLEAN NULL DEFAULT false,
    `has_drainage` BOOLEAN NULL DEFAULT false,
    `has_farmhouse_permission` BOOLEAN NULL DEFAULT false,

    UNIQUE INDEX `PropertyFarmLandDetails_property_id_key`(`property_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `PropertyVillaDetails` ADD CONSTRAINT `PropertyVillaDetails_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyHouseDetails` ADD CONSTRAINT `PropertyHouseDetails_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyCommercialShopDetails` ADD CONSTRAINT `PropertyCommercialShopDetails_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyCommercialOfficeDetails` ADD CONSTRAINT `PropertyCommercialOfficeDetails_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PropertyFarmLandDetails` ADD CONSTRAINT `PropertyFarmLandDetails_property_id_fkey` FOREIGN KEY (`property_id`) REFERENCES `Property`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
