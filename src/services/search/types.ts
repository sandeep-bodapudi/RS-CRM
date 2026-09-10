// Ported from the Sonthillu/Radha public-website BFFs' services/matching/types.ts
// (identical in both forks) as part of merging AI-powered search into the
// CRM backend so the static-exported frontends have a real server to call.

export type RequirementImportance =
  | 'HARD' // eligibility gate: mismatch excludes the candidate
  | 'STRONG_PREFERENCE'
  | 'SOFT_PREFERENCE'
  | 'FLEXIBLE'
  | 'EXCLUDED' // value is explicitly unwanted: match excludes the candidate
  | 'UNKNOWN';

export type RequirementPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type RequirementFlexibility = 'LOW' | 'MEDIUM' | 'HIGH';

export type RequirementOperator =
  | 'EQUALS'
  | 'NOT_EQUALS'
  | 'GREATER_THAN'
  | 'LESS_THAN'
  | 'BETWEEN'
  | 'IN'
  | 'CONTAINS'
  | 'EXCLUDES';

export interface Requirement {
  field: string;
  operator: RequirementOperator;
  value: unknown;
  importance: RequirementImportance;
  priority?: RequirementPriority;
  flexibility?: RequirementFlexibility;
  /** e.g., budget stretch percentage (0.15 = 15%). */
  tolerance?: number;
}

export interface RequirementModel {
  requirements: Requirement[];
  rawQuery?: string;
  confidence?: number;
}

export type FieldEvaluationStatus = 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN' | 'MISSING' | 'NOT_APPLICABLE';

export interface FieldEvaluation {
  satisfaction: number;
  status: FieldEvaluationStatus;
  reason: string;
  matchedValue?: unknown;
  requestedValue?: unknown;
  deviation?: unknown;
}

export type MatchBand = 'EXCELLENT' | 'VERY_GOOD' | 'GOOD' | 'RELATED' | 'NO_MATCH';
export type ResultTier = 'PRIMARY' | 'CLOSE' | 'RELATED' | 'NO_MATCH';

export interface MatchExplanation {
  score: number;
  band: MatchBand;
  matched: string[];
  partial: string[];
  deviations: string[];
  unknown: string[];
  missing: string[];
  notApplicable: string[];
}

export interface RankedProperty<T> {
  property: T;
  score: number;
  tier: ResultTier;
  explanation: MatchExplanation;
}

/** Search-engine-facing candidate shape — a flattened, camelCase view built
 * from a standalone Property row (see search/dto.ts's toSearchCandidate). */
export interface MatchCandidate {
  id: number;
  price: number;
  priceFormatted?: string;
  propertyType: string;
  listingType?: string | null;
  possessionStatus?: string | null;
  facing?: string | null;
  location: string;
  areaSqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  amenities?: string[];
  priceMin?: number;
  priceMax?: number;
  parking?: boolean | 'UNKNOWN' | 'NOT_APPLICABLE';
  floor?: number | null;
  state?: string | null;
  city?: string | null;
  locality?: string | null;
}
