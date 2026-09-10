-- Expands Lead.exit_reason's enum from 6 to 16 values (consolidation plan
-- Phase 2 — the drop-reason dropdown). Purely additive: MODIFY COLUMN on a
-- MySQL native ENUM widens the allowed value set without touching any
-- existing row (existing 6 values keep their same names/order prefix).
ALTER TABLE `Lead`
  MODIFY COLUMN `exit_reason` ENUM(
    'NO_MATCHING_INVENTORY',
    'CHOSE_COMPETITOR',
    'BUDGET_MISMATCH',
    'NOT_READY',
    'DO_NOT_CONTACT',
    'UNRESPONSIVE',
    'INVALID_CONTACT',
    'DUPLICATE_LEAD',
    'FINANCING_ISSUE',
    'LOCATION_MISMATCH',
    'ALREADY_PURCHASED',
    'JUST_ENQUIRING',
    'SITE_VISIT_NO_SHOW',
    'NEGOTIATION_FAILED',
    'OUT_OF_SERVICE_AREA',
    'OTHER'
  ) NULL;
