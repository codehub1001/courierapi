
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

// Broad geographic guard for Lagos-area results.
// Replace with your actual delivery-zone polygon when available.
const LAGOS_BOUNDS = {
  minLat: 6.30,
  maxLat: 6.90,
  minLon: 2.65,
  maxLon: 4.30,
};

// Nominatim viewbox order: left, top, right, bottom.
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
    .trim();

const isInsideLagosBounds = (latitude, longitude) =>
  latitude >= LAGOS_BOUNDS.minLat &&
  latitude <= LAGOS_BOUNDS.maxLat &&
  longitude >= LAGOS_BOUNDS.minLon &&
  longitude <= LAGOS_BOUNDS.maxLon;

const hasValidCoordinates = (latitude, longitude) =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

/**
 * Classify the quality of a Nominatim match conservatively.
 * STREET and AREA results are approximate and must not be used
 * for automatic fare calculation by the current estimateFare controller.
 */
const determinePrecision = (result) => {
  const details = result.address ?? {};
  const resultClass = String(result.class ?? "").toLowerCase();
  const resultType = String(result.type ?? "").toLowerCase();

  const hasRoad =
    Boolean(details.road) ||
    Boolean(details.pedestrian) ||
    Boolean(details.footway);

  const hasHouseNumber = Boolean(details.house_number);
  const hasBuilding = Boolean(details.building);

  // A house number plus a road is the strongest address-level match.
  // A building label alone is not enough to prove the user's intended
  // pickup or destination.
  if (hasHouseNumber && hasRoad) {
    return {
      precision: "EXACT",
      isApproximate: false,
    };
  }

  // A named building on a road can be useful, but remains approximate
  // until the user confirms the location.
  if (hasBuilding && hasRoad) {
    return {
      precision: "STREET",
      isApproximate: true,
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
 * Turn an address into a geocoding query.
 * Exact landmark searches receive a canonical landmark name.
 * Other addresses are preserved to avoid losing house numbers
 * or street details.
 */
const buildQuery = (address) => {
  const normalized = normalizeAddress(address);
  const lookupKey = normalized
    .toLowerCase()
    .replace(/[.,]/g, "")
    .trim();

  if (LANDMARK_ALIASES[lookupKey]) {
    return LANDMARK_ALIASES[lookupKey];
  }

  // Preserve the complete address and add Nigeria if not supplied.
  if (/\bnigeria\b/i.test(normalized)) {
    return normalized;
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
 * Geocode a pickup or destination address for Swiftbox.
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
    if (typeof address !== "string" || !address.trim()) {
      console.warn("Invalid address supplied for geocoding.");
      return null;
    }

    const originalAddress = normalizeAddress(address);

    // Prevent excessively long or meaningless queries.
    if (originalAddress.length < 3 || originalAddress.length > 300) {
      console.warn("Address length is invalid.");
      return null;
    }

    const queries = [buildQuery(originalAddress)];
    const cleaned = sanitizeAddress(originalAddress);

    if (cleaned && cleaned !== originalAddress) {
      queries.push(buildQuery(cleaned));
    }

    // Remove duplicate retry queries.
    const uniqueQueries = [...new Set(queries)];

    for (const query of uniqueQueries) {
      const params = new URLSearchParams({
        format: "jsonv2",
        q: query,
        countrycodes: "ng",
        limit: "1",
        addressdetails: "1",
        viewbox: LAGOS_VIEWBOX,
        bounded: "1",
      });

      console.info("Geocoding address:", query);

      const response = await fetch(
        `${NOMINATIM_URL}?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            // Replace with a real support email and your actual product name.
            "User-Agent": "Swiftbox Delivery Platform (support@yourdomain.com)",
          },
          signal: AbortSignal.timeout(8000),
        }
      );

      if (!response.ok) {
        console.error(
          "Nominatim request failed:",
          response.status,
          response.statusText
        );

        // Do not turn an API outage into a guessed fare.
        return null;
      }

      const results = await response.json();

      if (!Array.isArray(results) || results.length === 0) {
        continue;
      }

      const result = results[0];
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);
      const addressDetails = result.address ?? {};

      if (!hasValidCoordinates(latitude, longitude)) {
        console.warn("Geocoder returned invalid coordinates.");
        continue;
      }

      // Reject results outside the broad Lagos bounding box.
      // This is a guard, not a precise delivery-zone boundary.
      if (!isInsideLagosBounds(latitude, longitude)) {
        console.warn("Geocoder result is outside the Lagos bounds.");
        continue;
      }

      // Require the geocoder to identify Nigeria.
      const countryCode = String(
        addressDetails.country_code ?? ""
      ).toLowerCase();

      if (countryCode !== "ng") {
        console.warn("Geocoder result is not confirmed as Nigerian.");
        continue;
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
    }

    // Crucially: no area-anchor fallback and no central-Lagos fallback.
    console.warn("Could not verify the supplied address.");
    return null;
  } catch (error) {
    console.error("Geocoding service error:", error);
    return null;
  }
};
