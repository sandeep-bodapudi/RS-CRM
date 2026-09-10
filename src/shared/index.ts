// Phase 4.4 (2026-09-07): split from a single ~1575-line file into
// single-responsibility modules by domain. This barrel re-exports everything
// under its original name so no import site anywhere in the codebase
// (`from '../shared'`, `from '@rrh-ems/shared'`) needed to change.
export * from './auth';
export * from './attendance';
export * from './task';
export * from './lead';
export * from './project';
export * from './property';
export * from './projectUnit';
export * from './amenity';
export * from './expenseRefund';
export * from './customer';
export * from './document';
export * from './portal';
export * from './siteVisit';
export * from './messageTemplate';
export * from './employee';
export * from './websiteAccount';
