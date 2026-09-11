import type { MatchCandidate } from './types';

/** category -> the 3-value PropertyType vocabulary the matching engine (and
 * both public frontends' UI) understand. Anything outside residential
 * apartment/villa/house degrades to 'APARTMENT' rather than crashing —
 * mirrors the frontends' own dto.ts fallback. */
function mapCategoryToPropertyType(category: string): string {
  const normalized = (category || '').toUpperCase().replace(/[\s-]/g, '_');
  if (
    normalized.includes('APARTMENT') ||
    normalized.includes('FLAT') ||
    normalized.includes('STUDIO') ||
    normalized.includes('PENTHOUSE')
  ) {
    return 'APARTMENT';
  }
  if (normalized.includes('VILLA')) return 'VILLA';
  if (
    normalized.includes('INDEPENDENT') ||
    normalized.includes('HOUSE') ||
    normalized.includes('DUPLEX')
  )
    return 'INDEPENDENT_HOUSE';
  return 'APARTMENT';
}

function parseAmenities(amenities: string | null | undefined): string[] {
  if (!amenities) return [];
  try {
    const parsed = JSON.parse(amenities);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // not JSON — fall through to comma-split
  }
  return amenities
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);
}

function formatINR(price: number): string {
  if (price >= 10000000) {
    const cr = price / 10000000;
    return cr % 1 === 0 ? `₹${cr} Cr` : `₹${cr.toFixed(2)} Cr`;
  }
  if (price >= 100000) {
    const l = price / 100000;
    return l % 1 === 0 ? `₹${l} L` : `₹${l.toFixed(2)} L`;
  }
  return `₹${price.toLocaleString('en-IN')}`;
}

/** Shapes a Property row (selected with public.ts's PUBLIC_PROPERTY_SELECT)
 * into what the matching engine and the search response need. */
export function toSearchCandidate(property: any): MatchCandidate {
  return {
    id: property.id,
    // § Phase 3: Property.price was removed — final_price is the only
    // authoritative price now. MatchCandidate.price stays named `price`
    // (internal DTO field, not the DB column).
    price: property.final_price,
    priceFormatted: formatINR(property.final_price),
    propertyType: mapCategoryToPropertyType(property.category),
    listingType: property.listing_type || 'NEW',
    possessionStatus: property.possession_status,
    facing: property.facing,
    location: property.location,
    areaSqft: property.area_sqft,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    amenities: parseAmenities(property.amenities),
    state: property.state,
    city: property.city,
    locality: property.locality,
  };
}
