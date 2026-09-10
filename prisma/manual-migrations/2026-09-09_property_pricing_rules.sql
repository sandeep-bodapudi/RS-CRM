-- § Phase 3: Property gets its own conditional pricing rules, mirroring
-- ProjectPricingRule's shape (facing/corner/park/road-facing match
-- conditions), scoped per-property rather than per-project.
CREATE TABLE `PropertyPricingRule` (
  id INT AUTO_INCREMENT PRIMARY KEY,
  property_id INT NOT NULL,

  label VARCHAR(191) NOT NULL,
  kind ENUM('BASE_RATE','PREMIUM','CHARGE','DISCOUNT','TAX') NOT NULL,
  category ENUM('FACING','FLOOR','CORNER','ROAD','PARK','VIEW','BHK','AMENITY','PARKING','INFRA','MAINTENANCE','LEGAL','CLUB','TAX','OTHER') NOT NULL,
  calc_method ENUM('FIXED','PER_SQFT','PER_SQYD','PERCENT_OF_BASE','QTY_X_RATE') NOT NULL,
  rate DOUBLE NOT NULL,
  area_basis ENUM('SUPER_BUILT_UP','BUILT_UP','CARPET','PLOT_AREA','LUMPSUM') NULL,

  is_mandatory TINYINT(1) NOT NULL DEFAULT 1,
  is_tax TINYINT(1) NOT NULL DEFAULT 0,
  is_refundable TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,

  match_facing VARCHAR(191) NULL,
  match_corner TINYINT(1) NULL,
  match_park_facing TINYINT(1) NULL,
  match_road_facing TINYINT(1) NULL,
  match_main_road_facing TINYINT(1) NULL,

  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL,

  KEY PropertyPricingRule_property_id_kind_idx (property_id, kind),
  KEY PropertyPricingRule_property_id_is_active_idx (property_id, is_active),
  CONSTRAINT PropertyPricingRule_property_id_fkey FOREIGN KEY (property_id) REFERENCES `Property`(id) ON DELETE CASCADE
);

ALTER TABLE `PriceLine` ADD COLUMN `property_rule_id` INT NULL AFTER `rule_id`;
ALTER TABLE `PriceLine` ADD CONSTRAINT `PriceLine_property_rule_id_fkey` FOREIGN KEY (`property_rule_id`) REFERENCES `PropertyPricingRule`(id) ON DELETE SET NULL;
CREATE INDEX `PriceLine_property_rule_id_idx` ON `PriceLine`(`property_rule_id`);
