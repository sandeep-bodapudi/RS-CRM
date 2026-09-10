-- § Phase 3: Property.price (manually-typed listing price) could silently
-- diverge from the pricing engine's final_price. final_price is now the sole
-- authoritative price for a Property; every consumer (search, matching,
-- booking, WhatsApp messaging) was migrated to read final_price before this
-- migration was applied.
ALTER TABLE `Property` DROP COLUMN `price`;

-- final_price replaces price as the public search filter/sort column.
CREATE INDEX `Property_final_price_idx` ON `Property`(`final_price`);
