
/**
 * utils/geocoding.js
 *
 * Swiftbox Lagos geocoding service.
 *
 * - No fallback or fabricated coordinates.
 * - Searches multiple matching results.
 * - Validates country and Lagos geographic bounds.
 * - Prefers matching house numbers.
 * - Never treats an area or street as an exact building.
 */

const NOMINATIM_URL =
  "https://nominatim.openstreetmap.org/search";

const LAGOS_BOUNDS = {
  minLat: 6.3,
  maxLat: 6.9,
  minLon: 2.65,
  maxLon: 4.3,
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

const normalizeAddress = (value) =>
  value
    .normalize("NFKC")
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
  const key = address
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return LANDMARK_ALIASES[key] ?? null;
};

const buildQuery = (address) => {
  const normalized = normalizeAddress(address);
  const alias = getLandmarkAlias(normalized);

  if (alias) return alias;

  if (/\bnigeria\b/i.test(normalized)) {
    return normalized;
  }

  if (/\blagos\b/i.test(normalized)) {
    return `${normalized}, Nigeria`;
  }

  return `${normalized}, Lagos, Nigeria`;
};

const sanitizeAddress = (address) =>
  normalizeAddress(address)
    .replace(
      /^(?:no\.?\s*|flat\s+\d+\s*,?\s*|unit\s+\d+\s*,?\s*|suite\s+\d+\s*,?\s*|block\s+[a-z0-9]+\s*,?\s*)/i,
      ""
    )
    .trim();

/**
 * Extract a leading building number when present.
 * Examples: 14B Sunflower Street -> 14B
 */
const extractHouseNumber = (address) => {
  const match = address.match(
    /^\s*(?:no\.?\s*)?(\d+[a-z]?(?:\/\d+[a-z]?)?)\b/i
  );

  return match?.[1]?.toUpperCase() ?? null;
}

const normalizeHouseNumber = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();

const determinePrecision = (result) => {
  const details = result.address ?? {};

  const hasRoad = Boolean(
    details.road ||
    details.pedestrian ||
    details.footway
  );

  const hasHouseNumber = Boolean(details.house_number);

  if (hasRoad && hasHouseNumber) {
    return {
      precision: "EXACT",
      isApproximate: false,
    };
  }

  if (
    hasRoad ||
    String(result.class ?? "").toLowerCase() === "highway"
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
 * Fetch several possible matches from Nominatim.
 * Network/API failures throw so they can be logged separately
 * from a successful search with no results.
 */
const fetchNominatim = async (query, useBounds = true) => {
  const params = new URLSearchParams({
    format: "jsonv2",
    q: query,
    countrycodes: "ng",
    limit: "5",
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
      // Replace this with your real support email.
      "User-Agent": "Swiftbox Delivery Platform (support@yourdomain.com)",
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(
      `Nominatim returned HTTP ${response.status}`
    );
  }

  const results = await response.json();

  if (!Array.isArray(results)) {
    throw new Error("Nominatim returned an invalid response.");
  }

  return results;
};

/**
 * Validate and convert a Nominatim result.
 *
 * If the user supplied a building number and the result supplies
 * a different number, reject it rather than silently choosing
 * another building.
 */
const convertResult = (result, requestedHouseNumber, query) => {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  const addressDetails = result.address ?? {};

  if (!hasValidCoordinates(latitude, longitude)) {
    return null;
  }

  if (!isInsideLagosBounds(latitude, longitude)) {
    return null;
  }

  if (
    String(addressDetails.country_code ?? "").toLowerCase() !== "ng"
  ) {
    return null;
  }

  const resultHouseNumber = addressDetails.house_number;

  if (requestedHouseNumber && resultHouseNumber) {
    if (
      normalizeHouseNumber(resultHouseNumber) !==
      normalizeHouseNumber(requestedHouseNumber)
    ) {
      return null;
    }
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
 * Geocode a pickup or recipient address.
 *
 * Returns:
 * {
 *   latitude,
 *   longitude,
 *   displayName,
 *   precision: "EXACT" | "STREET" | "AREA",
 *   isApproximate,
 *   addressDetails
 * }
 *
 * Returns null when no acceptable result can be found.
 */
export const geocodeAddress = async (address) => {
  if (typeof address !== "string") {
    console.warn("Invalid address supplied for geocoding.");
    return null;
  }

  const originalAddress = normalizeAddress(address);

  if (
    originalAddress.length < 3 ||
    originalAddress.length > 300
  ) {
    console.warn("Address length is invalid.");
    return null;
  }

  const cleanedAddress = sanitizeAddress(originalAddress);
  const requestedHouseNumber = extractHouseNumber(originalAddress);

  const queries = [
    buildQuery(originalAddress),
    ...(cleanedAddress && cleanedAddress !== originalAddress
      ? [buildQuery(cleanedAddress)]
      : []),
  ];

  const uniqueQueries = [...new Set(queries)];

  let hadRequestError = false;

  for (const query of uniqueQueries) {
    // First search within the broad Lagos bounds.
    let results = [];

    try {
      results = await fetchNominatim(query, true);
    } catch (error) {
      hadRequestError = true;
      console.error(
        "Bounded geocoding request failed:",
        error.message
      );
    }

    for (const result of results) {
      const location = convertResult(
        result,
        requestedHouseNumber,
        query
      );

      if (location) {
        return location;
      }
    }

    // If no acceptable match was found, try a Nigeria-wide search.
    // Returned results are still restricted to Lagos bounds.
    try {
      results = await fetchNominatim(query, false);
    } catch (error) {
      hadRequestError = true;
      console.error(
        "Unbounded geocoding request failed:",
        error.message
      );
      continue;
    }

    for (const result of results) {
      const location = convertResult(
        result,
        requestedHouseNumber,
        query
      );

      if (location) {
        return location;
      }
    }
  }

  if (hadRequestError) {
    console.warn(
      "Geocoding could not complete successfully for every search."
    );
  }

  console.warn(
    "Could not verify the supplied address:",
    originalAddress
  );

  return null;
};
