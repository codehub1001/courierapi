
/**
 * utils/geocoding.js
 *
 * Swiftbox geocoding service.
 * Resolves Lagos pickup and destination addresses using Nominatim.
 *
 * Important:
 * - Never invent coordinates when geocoding fails.
 * - Approximate locations must not be used for automatic pricing.
 * - Geographic bounds are a broad guard, not an exact delivery boundary.
 */

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

const LAGOS_BOUNDS = {
  minLat: 6.30,
  maxLat: 6.90,
  minLon: 2.65,
  maxLon: 4.30,
};

const LAGOS_VIEWBOX = "2.65,6.90,4.30,6.30";

const LANDMARK_ALIASES = {
  "computer village": "Computer Village, Ikeja, Lagos, Nigeria",
  "trade fair": "Trade Fair Complex, Lagos, Nigeria",
  alaba: "Alaba International Market, Ojo, Lagos, Nigeria",
  balogun: "Balogun Market, Lagos Island, Nigeria",
  oshodi: "Oshodi, Lagos, Nigeria",
  cms: "CMS Bus Stop, Lagos Island, Nigeria",
  "mile 2": "Mile 2, Amuwo-Odofin, Lagos, Nigeria",
  "lekki phase 1": "Lekki Phase 1, Lagos, Nigeria",
};

/**
 * Normalize whitespace and punctuation.
 */
const normalizeAddress = (value) =>
  value
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:,\s*){2,}/g, ", ")
    .trim()
    .replace(/^,\s*|\s*,$/g, "");

/**
 * Check valid latitude and longitude ranges.
 */
const hasValidCoordinates = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

/**
 * Broad geographic check for Lagos-area results.
 */
const isInsideLagosBounds = (latitude, longitude) =>
  latitude >= LAGOS_BOUNDS.minLat &&
  latitude <= LAGOS_BOUNDS.maxLat &&
  longitude >= LAGOS_BOUNDS.minLon &&
  longitude <= LAGOS_BOUNDS.maxLon;

/**
 * Match a known landmark only when the entire input is the landmark.
 * Avoids replacing a full street address merely because it contains
 * a word such as "Oshodi" or "Alaba".
 */
const getLandmarkAlias = (address) => {
  const key = address
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return LANDMARK_ALIASES[key] ?? null;
};

/**
 * Build a clean query without duplicating Lagos or Nigeria.
 */
const buildQuery = (address) => {
  const normalized = normalizeAddress(address);
  const alias = getLandmarkAlias(normalized);

  if (alias) return alias;

  const hasNigeria = /\bnigeria\b/i.test(normalized);
  const hasLagos = /\blagos\b/i.test(normalized);

  if (hasNigeria) return normalized;

  if (hasLagos) return `${normalized}, Nigeria`;

  return `${normalized}, Lagos, Nigeria`;
};

/**
 * Remove common unit prefixes for a secondary search.
 * The original query is always attempted first.
 */
const sanitizeAddress = (address) =>
  normalizeAddress(address)
    .replace(
      /^(?:no\.?\s*|flat\s+\d+\s*,?\s*|unit\s+\d+\s*,?\s*|suite\s+\d+\s*,?\s*|block\s+[a-z0-9]+\s*,?\s*)/i,
      ""
    )
    .trim();

/**
 * Classify the returned OSM result conservatively.
 *
 * EXACT means the result contains a house number and road.
 * It does not guarantee that the result matches the user's intended
 * building; the returned displayName must still be checked.
 */
const determinePrecision = (result) => {
  const details = result.address ?? {};
  const resultClass = String(result.class ?? "").toLowerCase();
  const resultType = String(result.type ?? "").toLowerCase();

  const hasRoad = Boolean(
    details.road || details.pedestrian || details.footway
  );

  const hasHouseNumber = Boolean(details.house_number);

  if (hasHouseNumber && hasRoad) {
    return {
      precision: "EXACT",
      isApproximate: false,
    };
  }

  if (
    hasRoad ||
    resultClass === "highway" ||
    ["road", "residential", "tertiary", "secondary", "primary"].includes(
      resultType
    )
  ) {
    return {
      precision: "STREET",
      isApproximate: true,
    };
  }

  return {
    precision: "AREA",
    isApproximate: true,
  };
};

/**
 * Query Nominatim once.
 */
const fetchNominatim = async (query, useBounds = true) => {
  const params = new URLSearchParams({
    format: "jsonv2",
    q: query,
    countrycodes: "ng",
    limit: "1",
    addressdetails: "1",
  });

  if (useBounds) {
    params.set("viewbox", LAGOS_VIEWBOX);
    params.set("bounded", "1");
  }

  const url = `${NOMINATIM_URL}?${params.toString()}`;

  console.info("Geocoding address:", query);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      // Use a real contact address for your deployed service.
      "User-Agent": "Swiftbox Delivery Platform (support@yourdomain.com)",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    console.error(
      "Nominatim request failed:",
      response.status,
      response.statusText
    );

    return null;
  }

  const results = await response.json();

  if (!Array.isArray(results) || results.length === 0) {
    return null;
  }

  const result = results[0];

  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  const addressDetails = result.address ?? {};

  if (!hasValidCoordinates(latitude, longitude)) {
    console.warn("Nominatim returned invalid coordinates.");
    return null;
  }

  if (!isInsideLagosBounds(latitude, longitude)) {
    console.warn("Nominatim result is outside the allowed Lagos bounds.");
    return null;
  }

  const countryCode = String(
    addressDetails.country_code ?? ""
  ).toLowerCase();

  if (countryCode !== "ng") {
    console.warn("Nominatim result is not confirmed as Nigerian.");
    return null;
  }

  const { precision, isApproximate } = determinePrecision(result);

  return {
    latitude,
    longitude,
    displayName: String(result.display_name ?? query),
    precision,
    isApproximate,
    addressDetails,
  };
};

/**
 * Geocode a pickup or destination address.
 *
 * @param {string} address
 * @returns {Promise<{
 *   latitude: number,
 *   longitude: number,
 *   displayName: string,
 *   precision: "EXACT"|"STREET"|"AREA",
 *   isApproximate: boolean,
 *   addressDetails: object|null
 * }|null>}
 */
export const geocodeAddress = async (address) => {
  try {
    if (typeof address !== "string") {
      console.warn("Invalid address supplied for geocoding.");
      return null;
    }

    const originalAddress = normalizeAddress(address);

    if (originalAddress.length < 3 || originalAddress.length > 300) {
      console.warn("Address length is invalid.");
      return null;
    }

    const cleanedAddress = sanitizeAddress(originalAddress);

    const queries = [
      buildQuery(originalAddress),
      ...(cleanedAddress && cleanedAddress !== originalAddress
        ? [buildQuery(cleanedAddress)]
        : []),
    ];

    const uniqueQueries = [...new Set(queries)];

    for (let index = 0; index < uniqueQueries.length; index += 1) {
      const query = uniqueQueries[index];

      // Try the Lagos-bounded search first.
      let result = await fetchNominatim(query, true);

      // If the bounded search has no match, try an unrestricted Nigeria
      // search, but still reject results outside Lagos bounds.
      if (!result) {
        // Avoid retrying nationwide after an HTTP/API failure.
        // A null result alone cannot distinguish failure from no match,
        // so fetchNominatim handles errors by returning null.
        // The second query is attempted below when available.
      }

      if (result) {
        return result;
      }

      // A nationwide retry can find Lagos addresses omitted by the
      // bounded search. Any returned result is still bounds-checked.
      result = await fetchNominatim(query, false);

      if (result) {
        return result;
      }
    }

    console.warn("Could not verify the supplied address.");
    return null;
  } catch (error) {
    console.error("Geocoding service error:", error);
    return null;
  }
};
