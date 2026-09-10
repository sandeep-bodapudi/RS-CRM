-- Adds a free-text companion column for LeadExitReason = OTHER, purely
-- additive, nullable, no default touching existing rows.
ALTER TABLE `Lead`
  ADD COLUMN `exit_reason_detail` VARCHAR(191) NULL AFTER `exit_reason`;
