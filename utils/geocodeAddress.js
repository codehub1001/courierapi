/**
 * utils/geocoding.js
 *
 * Swiftbox Lagos Geocoding Service (Zero-Registration / OpenStreetMap)
 * 
 * - Fully free, no API keys or external billing required.
 * - Handles local Lagos formats, estates, and complex multi-street corridors.
 * - Progressive fallbacks from exact building search down to street and area match.
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

const LANDMARK_ALIASES = {
  "computer village": "Computer Village, Ikeja, Lagos, Nigeria",
  "trade fair": "Trade Fair Complex, Lagos, Nigeria",
  "alaba": "Alaba International Market, Ojo, Lagos, Nigeria",
  "balogun": "Balogun Market, Lagos Island, Nigeria",
  "oshodi": "Oshodi, Lagos, Nigeria",
  "cms": "CMS Bus Stop, Lagos Island, Nigeria",
  "mile 2": "Mile 2, Amuwo-Odofin, Lagos, Nigeria",
  "lekki phase 1": "Lekki Phase 1, Lagos, Nigeria",
  "mko abiola gardens": "MKO Abiola Gardens, Ikeja, Lagos, Nigeria",
  "jemtok": "Jemtok Street, Okota, Isolo, Lagos, Nigeria",
  "ago palace": "Ago Palace Way, Okota, Isolo, Lagos, Nigeria",
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

const getLandmarkAlias = (address) => {
  const cleaned = address.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
  for (const [key, val] of Object.entries(LANDMARK_ALIASES)) {
    if (cleaned.includes(key)) {
      return val;
    }
  }
  return null;
};

/**
 * Generates intelligent progressive search queries for Nominatim without premature returns
 */
const buildQueries = (address) => {
  const normalized = normalizeAddress(address);
  const alias = getLandmarkAlias(normalized);

  // Clean common typos or missing endings
  let cleaned = normalized
    .replace(/\b(agos)\b/gi, "Lagos")
    .replace(/\b(lag)\b/gi, "Lagos");

  // Strip leading house numbers/units to create street-level fallbacks
  const withoutHouseNumber = cleaned.replace(
    /^\s*(?:no\.?\s*)?\d+[a-z]?(?:\/\d+[a-z]?)?\s*,?\s*/i,
    ""
  );

  // Extract major segments (e.g., street name and area context)
  const segments = withoutHouseNumber.split(',').map(s => s.trim()).filter(Boolean);
  const primaryStreet = segments[0] || cleaned;
  const secondaryArea = segments.length > 1 ? segments[1] : "Lagos";

  const queries = [
    alias, // Included as a search option instead of blocking the queue
    `${cleaned}, Lagos, Nigeria`,
    `${withoutHouseNumber}, Lagos, Nigeria`,
    `${primaryStreet}, ${secondaryArea}, Lagos, Nigeria`,
    `${primaryStreet}, Lagos, Nigeria`,
    // If it contains "ago palace", make sure that corridor is explicitly searched
    /ago palace/i.test(cleaned) ? "Ago Palace Way, Okota, Lagos, Nigeria" : null,
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
  if (String(details.country_code ?? "").toLowerCase() !== "ng") return null;

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
    limit: "5",
    addressdetails: "1",
  });

  const url = `${NOMINATIM_URL}?${params.toString()}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`Nominatim HTTP ${response.status}`);
  }

  const results = await response.json();
  return Array.isArray(results) ? results : [];
};

export const geocodeAddress = async (address) => {
  if (typeof address !== "string" || address.trim().length < 3) {
    console.warn("[Geocoding] Invalid address input.");
    return null;
  }

  const originalAddress = normalizeAddress(address);
  const queries = buildQueries(originalAddress);

  console.info("[Geocoding] Starting address verification:", originalAddress);
  console.info("[Geocoding] Search variations queue:", queries);

  let bestApproximateMatch = null;
  let streetMatch = null;

  for (const query of queries) {
    try {
      const results = await fetchNominatim(query);

      for (const result of results) {
        const location = convertResult(result, query);
        if (!location) continue;

        if (location.precision === "EXACT") {
          console.info("[Geocoding] Exact location matched:", location.displayName);
          return location;
        }

        if (location.precision === "STREET" && !streetMatch) {
          streetMatch = location;
        }

        if (!bestApproximateMatch) {
          bestApproximateMatch = location;
        }
      }
    } catch (error) {
      console.error(`[Geocoding] Query failed [${query}]:`, error?.message ?? error);
    }
  }

  if (streetMatch) {
    console.info("[Geocoding] Street-level location matched:", streetMatch.displayName);
    return streetMatch;
  }

  if (bestApproximateMatch) {
    console.warn("[Geocoding] Returning fallback area-level match:", bestApproximateMatch.displayName);
    return bestApproximateMatch;
  }

  console.warn("[Geocoding] All resolution strategies failed for:", originalAddress);
  return null;
};