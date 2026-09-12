/**
 * Top-tier Geocoding service with localized aliasing, bounding box constraints,
 * and multi-stage fallback precision recovery.
 * 
 * @param {string} address - The raw address string input from user or vendor.
 * @returns {Promise<{latitude: number, longitude: number, displayName: string, precision: 'EXACT'|'STREET'|'AREA', isApproximate: boolean, addressDetails: object}|null>}
 */
export const geocodeAddress = async (address) => {
  try {
    if (!address || typeof address !== "string") {
      console.warn("⚠️ Invalid address supplied for geocoding");
      return null;
    }

    const queryAddress = address.trim();
    if (!queryAddress) return null;

    // 1. Local Landmark & Hub Dictionary for smart query injection
    const landmarkAliases = {
      "computer village": "Computer Village, Ikeja, Lagos",
      "trade fair": "Badagry Expressway, Trade Fair, Lagos",
      "alaba": "Alaba International Market, Ojo, Lagos",
      "balogun": "Balogun Market, Lagos Island, Lagos",
      "oshodi": "Oshodi Interchange, Lagos",
      "CMS": "CMS Bus Stop, Lagos Island, Lagos",
      "mile 2": "Mile 2, Amuwo-Odofin, Lagos",
      "lekki phase 1": "Lekki Phase 1, Lagos",
    };

    const determinePrecision = (result) => {
      const details = result.address || {};
      const resultClass = result.class || "";

      if (details.house_number || details.building || ["building", "amenity", "shop", "office"].includes(resultClass)) {
        return { precision: "EXACT", isApproximate: false };
      }

      if (details.road || details.pedestrian || details.footway || ["highway"].includes(resultClass)) {
        return { precision: "STREET", isApproximate: false };
      }

      return { precision: "AREA", isApproximate: true };
    };

    const fetchNominatim = async (queryString, useBoundingBox = true) => {
      let formattedQuery = queryString;
      
      // Check if it matches any local landmark alias first
      const lowerQuery = queryString.toLowerCase();
      for (const [key, val] of Object.entries(landmarkAliases)) {
        if (lowerQuery.includes(key)) {
          formattedQuery = val;
          break;
        }
      }

      if (!formattedQuery.toLowerCase().includes("nigeria")) {
        formattedQuery = `${formattedQuery}, Nigeria`;
      }

      console.log("🔍 Querying Nominatim for:", formattedQuery);

      const params = new URLSearchParams({
        format: "json",
        q: formattedQuery,
        countrycodes: "ng",
        limit: "1",
        addressdetails: "1",
      });

      // Restrict search bounds to southwest Nigeria / Lagos region to eliminate false matches elsewhere
      if (useBoundingBox) {
        // Bounding box format: minlon, minlat, maxlon, maxlat (covers Lagos and immediate environs)
        params.append("viewbox", "2.68,6.35,4.25,6.85");
        params.append("bounded", "1");
      }

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "CourierX Delivery Platform (contact@courierx.com)",
          },
        }
      );

      if (!response.ok) {
        console.error("❌ Nominatim request failed:", response.status, response.statusText);
        return null;
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) return null;

      const result = data[0];
      const latitude = Number(result.lat);
      const longitude = Number(result.lon);

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

      const { precision, isApproximate } = determinePrecision(result);

      return {
        latitude,
        longitude,
        displayName: result.display_name,
        precision,
        isApproximate,
        addressDetails: result.address || null,
      };
    };

    // STAGE 1: Exact Query with Bounding Box
    let geocodeResult = await fetchNominatim(queryAddress, true);

    // STAGE 2: If bounded query fails, try unrestricted search across Nigeria
    if (!geocodeResult) {
      console.log("⚠️ Bounded search failed. Trying nationwide search for:", queryAddress);
      geocodeResult = await fetchNominatim(queryAddress, false);
    }

    // STAGE 3: Address Sanitization & Structural Cleanup (e.g., "70jemtok" -> "jemtok")
    if (!geocodeResult) {
      console.log("⚠️ Standard search failed. Attempting deep string cleanup for:", queryAddress);

      const cleanedAddress = queryAddress
        .replace(/^(no\.?\s*|flat\s*\d+\s*,?|unit\s*\d+\s*,?|suite\s*\d+\s*,?|block\s*[a-z0-9]+\s*,?)?/i, "")
        .replace(/^\d+[a-z]?[\s,]+/i, "")
        .replace(/^(\d+)([a-zA-Z]+)/, "$2") 
        .trim();

      if (cleanedAddress && cleanedAddress !== queryAddress) {
        console.log("🔍 Retrying Nominatim with sanitized street address:", cleanedAddress);
        geocodeResult = await fetchNominatim(cleanedAddress, true);
      }
    }

    // STAGE 4: Intelligent Neighborhood / Area Fallback
    if (!geocodeResult) {
      const lower = queryAddress.toLowerCase();
      let fallbackArea = null;

      if (lower.includes("okota")) fallbackArea = "Okota, Isolo, Lagos";
      else if (lower.includes("isolo")) fallbackArea = "Isolo, Lagos";
      else if (lower.includes("ikeja")) fallbackArea = "Ikeja, Lagos";
      else if (lower.includes("lekki")) fallbackArea = "Lekki, Lagos";
      else if (lower.includes("surulere")) fallbackArea = "Surulere, Lagos";
      else if (lower.includes("yaba")) fallbackArea = "Yaba, Lagos";
      else if (lower.includes("ajah")) fallbackArea = "Ajah, Lagos";
      else if (lower.includes("vi") || lower.includes("victoria island")) fallbackArea = "Victoria Island, Lagos";
      else if (lower.includes("ikoyi")) fallbackArea = "Ikoyi, Lagos";
      else if (lower.includes("ikotun")) fallbackArea = "Ikotun, Lagos";
      else if (lower.includes("egbeda")) fallbackArea = "Egbeda, Lagos";
      else if (lower.includes("festac")) fallbackArea = "Festac Town, Lagos";
      else if (lower.includes("ipaja")) fallbackArea = "Ipaja, Lagos";
      else if (lower.includes("ogba")) fallbackArea = "Ogba, Lagos";
      else if (lower.includes("magodo")) fallbackArea = "Magodo, Lagos";
      else if (lower.includes("oshodi")) fallbackArea = "Oshodi, Lagos";
      else if (lower.includes("abuja")) fallbackArea = "Abuja, FCT";
      else if (lower.includes("ibadan")) fallbackArea = "Ibadan, Oyo";
      else if (lower.includes("port harcourt") || lower.includes("ph")) fallbackArea = "Port Harcourt, Rivers";
      else fallbackArea = "Lagos, Nigeria"; // Ultimate default fallback for logistics continuity

      if (fallbackArea) {
        console.log("⚠️ Street level match failed. Falling back to targeted area level:", fallbackArea);
        geocodeResult = await fetchNominatim(fallbackArea, true);
        if (geocodeResult) {
          geocodeResult.precision = "AREA";
          geocodeResult.isApproximate = true;
        }
      }
    }

    if (!geocodeResult) {
      console.error("❌ Critical: Geocoding failed completely for address:", queryAddress);
      return null;
    }

    return geocodeResult;

  } catch (error) {
    console.error("❌ Geocoding system error:", error);
    return null;
  }
};