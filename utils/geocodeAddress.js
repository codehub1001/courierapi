/**
 * utils/geocoding.js
 *
 * Swiftbox Lagos geocoding service.
 *
 * - No fabricated coordinates.
 * - Normalizes informal Lagos addresses.
 * - Tries multiple search variations.
 * - Validates country and geographic bounds.
 * - Rejects conflicting house numbers.
 * - Prefers exact building matches over streets and areas.
 * - Logs search candidates and API errors.
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

const USER_AGENT =
  process.env.GEOCODING_USER_AGENT ||
  "Swiftbox Delivery Platform (contact: support@yourdomain.com)";

const LANDMARK_ALIASES = {
  "computer village": "Computer Village, Ikeja, Lagos, Nigeria",
  "trade fair": "Trade Fair Complex, Lagos, Nigeria",
  alaba: "Alaba International Market, Ojo, Lagos, Nigeria",
  balogun: "Balogun Market, Lagos Island, Nigeria",
  oshodi: "Oshodi, Lagos, Nigeria",
  cms: "CMS Bus Stop, Lagos Island, Nigeria",
  "mile 2": "Mile 2, Amuwo-Odofin, Lagos, Nigeria",
  "lekki phase 1": "Lekki Phase 1, Lagos, Nigeria",
  "mko abiola gardens": "MKO Abiola Gardens, Ikeja, Lagos, Nigeria",
  "mko abiola gardens estate": "MKO Abiola Gardens, Ikeja, Lagos, Nigeria",
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

const normalizeHouseNumber = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();

const extractHouseNumber = (address) => {
  // Avoid treating estate building/unit letters (like 14b in an estate context) as strict street house numbers if an estate keyword is present
  if (/\b(estate|gardens|court|plaza|mall|complex)\b/i.test(address)) {
    return null;
  }

  const match = address.match(
    /^\s*(?:no\.?\s*)?(\d+[a-z]?(?:\/\d+[a-z]?)?)\b/i
  );

  return match?.[1]?.toUpperCase() ?? null;
};

const removeLeadingUnit = (address) =>
  address
    .replace(
      /^(?:(?:no\.?|number)\s+\d+[a-z]?(?:\/\d+[a-z]?)?|flat\s+\d+[a-z]?|unit\s+\d+[a-z]?|suite\s+\d+[a-z]?|block\s+[a-z0-9]+)\s*,?\s*/i,
      ""
    )
    .trim();

const getLandmarkAlias = (address) => {
  const cleaned = address
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  for (const [key, val] of Object.entries(LANDMARK_ALIASES)) {
    if (cleaned.includes(key)) {
      return val;
    }
  }

  return null;
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

const buildQueries = (address) => {
  const normalized = normalizeAddress(address);
  const withoutLeadingUnit = removeLeadingUnit(normalized);
  const withoutHouseNumber = normalized.replace(
    /^\s*(?:no\.?\s*)?\d+[a-z]?(?:\/\d+[a-z]?)?\s*,?\s*/i,
    ""
  );

  const variants = [
    normalized,
    withoutLeadingUnit,
    withoutHouseNumber,
  ];

  return [
    ...new Set(
      variants
        .map((value) => buildQuery(value))
        .filter(Boolean)
    ),
  ];
};

const determinePrecision = (result) => {
  const details = result.address ?? {};

  const hasRoad = Boolean(
    details.road ||
    details.pedestrian ||
    details.footway ||
    details.residential ||
    details.suburb ||
    details.neighbourhood
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

const convertResult = (
  result,
  requestedHouseNumber,
  query
) => {
  const latitude = Number(result.lat);
  const longitude = Number(result.lon);
  const details = result.address ?? {};

  if (!hasValidCoordinates(latitude, longitude)) {
    return null;
  }

  if (!isInsideLagosBounds(latitude, longitude)) {
    return null;
  }

  if (
    String(details.country_code ?? "").toLowerCase() !== "ng"
  ) {
    return null;
  }

  const resultHouseNumber = details.house_number;

  if (requestedHouseNumber && resultHouseNumber) {
    if (
      normalizeHouseNumber(requestedHouseNumber) !==
      normalizeHouseNumber(resultHouseNumber)
    ) {
      return null;
    }
  }

  const { precision, isApproximate } =
    determinePrecision(result);

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

  console.info(
    `[Geocoding] ${useBounds ? "Lagos search" : "Broader search"}:`,
    query
  );

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Nominatim HTTP ${response.status}`);
  }

  const results = await response.json();

  if (!Array.isArray(results)) {
    throw new Error("Nominatim returned an invalid response.");
  }

  console.info(
    `[Geocoding] ${results.length} candidate(s) found for:`,
    query
  );

  return results;
};

export const geocodeAddress = async (address) => {
  if (typeof address !== "string") {
    console.warn("[Geocoding] Address must be a string.");
    return null;
  }

  const originalAddress = normalizeAddress(address);

  if (
    originalAddress.length < 3 ||
    originalAddress.length > 300
  ) {
    console.warn("[Geocoding] Invalid address length.");
    return null;
  }

  const requestedHouseNumber =
    extractHouseNumber(originalAddress);

  const queries = buildQueries(originalAddress);

  let hadRequestError = false;
  let bestApproximateMatch = null;
  let streetMatch = null;

  console.info(
    "[Geocoding] Starting address verification:",
    originalAddress
  );

  for (const query of queries) {
    for (const useBounds of [true, false]) {
      let results;

      try {
        results = await fetchNominatim(query, useBounds);
      } catch (error) {
        hadRequestError = true;
        console.error(
          `[Geocoding] ${
            useBounds ? "Lagos" : "Broader"
          } search failed:`,
          error?.message ?? error
        );
        continue;
      }

      for (const result of results) {
        const location = convertResult(
          result,
          requestedHouseNumber,
          query
        );

        if (!location) {
          continue;
        }

        if (location.precision === "EXACT") {
          console.info(
            "[Geocoding] Exact location matched:",
            location.displayName
          );
          return location;
        }

        if (location.precision === "STREET" && !streetMatch) {
          streetMatch = location;
        }

        if (!bestApproximateMatch) {
          bestApproximateMatch = location;
        }
      }
    }
  }

  if (streetMatch) {
    console.info(
      "[Geocoding] Street-level location matched:",
      streetMatch.displayName
    );
    return streetMatch;
  }

  if (bestApproximateMatch) {
    console.warn(
      "[Geocoding] Only an approximate location was found:",
      {
        address: originalAddress,
        precision: bestApproximateMatch.precision,
        displayName: bestApproximateMatch.displayName,
      }
    );
    return bestApproximateMatch;
  }

  if (hadRequestError) {
    console.error(
      "[Geocoding] One or more searches failed due to API or network errors."
    );
  }

  console.warn(
    "[Geocoding] No acceptable Lagos location found:",
    originalAddress
  );

  return null;
};