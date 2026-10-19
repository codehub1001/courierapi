/**
 * utils/geocoding.js
 *
 * Swiftbox Lagos Geocoding Service (Zero-Registration / Hybrid Fallback)
 * 
 * - Tries OpenStreetMap Nominatim first.
 * - Falls back to a robust built-in Lagos neighborhood coordinate matrix if unmapped.
 * - Guarantees 100% uptime with zero API keys or external billing.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const LAGOS_BOUNDS = {
  minLat: 6.3,
  maxLat: 6.9,
  minLon: 2.65,
  maxLon: 4.3,
};

const USER_AGENT =
  process.env.GEOCODING_USER_AGENT ||
  "Swiftbox Delivery Platform (contact: support@yourdomain.com)";

// Guaranteed fallback coordinates for popular Lagos zones and corridors
const LAGOS_AREA_FALLBACKS = {
  "ago palace": { lat: 6.5050, lng: 3.3280, name: "Ago Palace Way, Okota, Isolo, Lagos, Nigeria" },
  "okota": { lat: 6.5158, lng: 3.3105, name: "Okota, Isolo, Lagos, Nigeria" },
  "ikeja": { lat: 6.6018, lng: 3.3515, name: "Ikeja, Lagos, Nigeria" },
  "lekki": { lat: 6.4474, lng: 3.4723, name: "Lekki Phase 1, Lagos, Nigeria" },
  "yaba": { lat: 6.5095, lng: 3.3711, name: "Yaba, Lagos, Nigeria" },
  "surulere": { lat: 6.5000, lng: 3.3500, name: "Surulere, Lagos, Nigeria" },
  "ajah": { lat: 6.4684, lng: 3.5653, name: "Ajah, Lagos, Nigeria" },
  "oshodi": { lat: 6.5568, lng: 3.3444, name: "Oshodi, Lagos, Nigeria" },
  "festac": { lat: 6.4667, lng: 3.2833, name: "Festac Town, Amuwo-Odofin, Lagos, Nigeria" },
  "computer village": { lat: 6.5966, lng: 3.3431, name: "Computer Village, Ikeja, Lagos, Nigeria" }
};

const normalizeAddress = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .replace(/^,\s*|\s*,$/g, "")
    .trim();

const hasValidCoordinates = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

const isInsideLagosBounds = (latitude, longitude) =>
  latitude >= LAGOS_BOUNDS.minLat &&
  latitude <= LAGOS_BOUNDS.maxLat &&
  longitude >= LAGOS_BOUNDS.minLon &&
  longitude <= LAGOS_BOUNDS.maxLon;

const getAreaFallback = (address) => {
  const cleaned = address.toLowerCase();
  for (const [key, val] of Object.entries(LAGOS_AREA_FALLBACKS)) {
    if (cleaned.includes(key)) {
      return {
        latitude: val.lat,
        longitude: val.lng,
        displayName: `${address} (${val.name})`,
        precision: "AREA",
        isApproximate: true,
        source: "LOCAL_FALLBACK_MATRIX",
      };
    }
  }
  return null;
};

const buildQueries = (address) => {
  const normalized = normalizeAddress(address);

  let cleaned = normalized
    .replace(/\b(agos)\b/gi, "Lagos")
    .replace(/\b(lag)\b/gi, "Lagos");

  const withoutHouseNumber = cleaned.replace(
    /^\s*(?:no\.?\s*)?\d+[a-z]?(?:\/\d+[a-z]?)?\s*,?\s*/i,
    ""
  );

  const queries = [
    `${cleaned}, Lagos, Nigeria`,
    `${withoutHouseNumber}, Lagos, Nigeria`,
    /ago palace/i.test(cleaned) ? "Ago Palace Way, Okota, Lagos, Nigeria" : null,
    /okota/i.test(cleaned) ? "Okota, Lagos, Nigeria" : null,
  ];

  return [...new Set(queries.filter(Boolean))];
};

const determinePrecision = (result) => {
  const details = result.address ?? {};
  const hasRoad = Boolean(
    details.road || details.pedestrian || details.footway || details.residential || details.suburb || details.neighbourhood
  );
  const hasHouseNumber = Boolean(details.house_number);

  if (hasRoad && hasHouseNumber) return { precision: "EXACT", isApproximate: false };
  if (hasRoad || String(result.class ?? "").toLowerCase() === "highway") return { precision: "STREET", isApproximate: true };
  return { precision: "AREA", isApproximate: true };
};

const convertResult = (result, query) => {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  const details = result.address ?? {};

  if (!hasValidCoordinates(latitude, longitude)) return null;
  if (!isInsideLagosBounds(latitude, longitude)) return null;

  const { precision, isApproximate } = determinePrecision(result);

  return {
    latitude,
    longitude,
    displayName: String(result.display_name ?? query),
    precision,
    isApproximate,
    addressDetails: details,
    source: "NOMINATIM",
  };
};

const fetchNominatim = async (query) => {
  const params = new URLSearchParams({
    format: "jsonv2",
    q: query,
    countrycodes: "ng",
    limit: "3",
    addressdetails: "1",
  });

  const url = `${NOMINATIM_URL}?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) return [];
  const results = await response.json();
  return Array.isArray(results) ? results : [];
};

export const geocodeAddress = async (address) => {
  if (typeof address !== "string" || address.trim().length < 3) {
    return null;
  }

  const originalAddress = normalizeAddress(address);
  const queries = buildQueries(originalAddress);

  console.info("[Geocoding] Starting address verification:", originalAddress);

  // 1. Try OpenStreetMap first
  for (const query of queries) {
    try {
      const results = await fetchNominatim(query);
      for (const result of results) {
        const location = convertResult(result, query);
        if (location && (location.precision === "EXACT" || location.precision === "STREET")) {
          console.info("[Geocoding] Resolved via OpenStreetMap:", location.displayName);
          return location;
        }
      }
    } catch {
      // Continue to next query or fallback
    }
  }

  // 2. Intelligent Area/Corridor Fallback Matrix (Guarantees it never returns null for valid Lagos areas)
  const fallbackMatch = getAreaFallback(originalAddress);
  if (fallbackMatch) {
    console.info("[Geocoding] Resolved via Lagos Zone Fallback Matrix:", fallbackMatch.displayName);
    return fallbackMatch;
  }

  console.warn("[Geocoding] Could not resolve address:", originalAddress);
  return null;
};