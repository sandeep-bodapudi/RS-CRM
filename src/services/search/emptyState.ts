// Ported from the BFFs' services/matching/emptyState.ts — distinguishes
// "no inventory exists at all" from "no inventory matches this filter" so
// the UI can show the right empty-state message.
import type { MatchCandidate } from './types';

export function determineEmptyState(
  primaryFilters: Record<string, unknown>,
  publicProperties: MatchCandidate[],
  primaryError: boolean,
  anyPropertiesExist: boolean,
): { error: string | null; isGlobalEmpty: boolean } {
  const hasFilters = Object.keys(primaryFilters).length > 0;

  let isGlobalEmpty = false;
  if (!primaryError && publicProperties.length === 0) {
    if (!hasFilters) {
      isGlobalEmpty = true;
    } else if (!anyPropertiesExist) {
      isGlobalEmpty = true;
    }
  }

  const error = primaryError ? 'SEARCH_UNAVAILABLE' : null;

  return { error, isGlobalEmpty };
}
