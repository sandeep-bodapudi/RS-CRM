-- ============================================================================
-- Unit listing_type + Project multi-authority approvals
-- Generated 2026-09-12
--
-- Two purely additive columns from the user's manual QA pass (#12, #13):
--   * ProjectUnit.listing_type — mirrors Property.listing_type (NEW/RESALE),
--     nullable so existing units are unaffected.
--   * Project.approval_authorities — a JSON array replacing the old
--     single-value approval_authority column for projects that need sign-off
--     from more than one authority (e.g. both HMDA and GHMC). The old column
--     is left in place (deprecated, not dropped) so no data is lost.
--
-- SAFETY: 2 ADD COLUMN, 0 DROP, both nullable — no existing row can fail.
--
-- HOW TO APPLY
--   Local:      npx prisma db execute --url "$DATABASE_URL" --file apps/api/prisma/manual-migrations/2026-09-12_unit_listing_type_and_multi_approvals.sql
--   Production: run the same command with DATABASE_URL_PRODUCTION, deliberately.
-- ============================================================================

ALTER TABLE `ProjectUnit` ADD COLUMN `listing_type` VARCHAR(191) NULL;

ALTER TABLE `Project` ADD COLUMN `approval_authorities` JSON NULL;
