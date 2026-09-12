/**
 * Top-tier Geocoding service with local coordinate anchoring, 
 * smart sanitization, and zero-failure pricing fallback for CourierX.
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

    // 2. Direct Coordinate Anchors for unmapped micro-pockets (Guarantees accurate pricing)
    const localAreaAnchors = {
      okota: { latitude: 6.5056, longitude: 3.3289, name: "Okota, Isolo, Lagos, Nigeria" },
      ago: { latitude: 6.5120, longitude: 3.3150, name: "Ago Palace Way, Okota, Lagos, Nigeria" },
      isolo: { latitude: 6.5333, longitude: 3.3333, name: "Isolo, Lagos, Nigeria" },
      ikeja: { latitude: 6.6018, longitude: 3.3515, name: "Ikeja, Lagos, Nigeria" },
      lekki: { latitude: 6.4474, longitude: 3.4723, name: "Lekki Phase 1, Lagos, Nigeria" },
      surulere: { latitude: 6.5000, longitude: 3.3500, name: "Surulere, Lagos, Nigeria" },
      yaba: { latitude: 6.5175, longitude: 3.3841, name: "Yaba, Lagos, Nigeria" },
      egbeda: { latitude: 6.6100, longitude: 3.2800, name: "Egbeda, Lagos, Nigeria" },
      festac: { latitude: 6.4636, longitude: 3.2831, name: "Festac Town, Lagos, Nigeria" },
      oshodi: { latitude: 6.5539, longitude: 3.3456, name: "Oshodi, Lagos, Nigeria" }
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

      if (useBoundingBox) {
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

    // STAGE 3: Address Sanitization & Structural Cleanup
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

    // STAGE 4: Instant Micro-Area Anchor Fallback (Prevents pricing errors & network timeouts)
    if (!geocodeResult) {
      const lower = queryAddress.toLowerCase();
      let matchedAnchor = null;

      for (const [key, anchorData] of Object.entries(localAreaAnchors)) {
        if (lower.includes(key)) {
          matchedAnchor = anchorData;
          break;
        }
      }

      if (matchedAnchor) {
        console.log(`📍 Using local coordinate anchor for zone: ${matchedAnchor.name}`);
        geocodeResult = {
          latitude: matchedAnchor.latitude,
          longitude: matchedAnchor.longitude,
          displayName: matchedAnchor.name,
          precision: "AREA",
          isApproximate: true,
          addressDetails: { suburb: matchedAnchor.name, city: "Lagos" }
        };
      } else {
        // Ultimate fallback to central Lagos coordinates to maintain delivery pricing continuity
        console.warn("⚠️ Unrecognized zone. Falling back to default Lagos anchor.");
        geocodeResult = {
          latitude: 6.5244,
          longitude: 3.3792,
          displayName: "Lagos, Nigeria",
          precision: "AREA",
          isApproximate: true,
          addressDetails: { city: "Lagos" }
        };
      }
    }

    return geocodeResult;

  } catch (error) {
    console.error("❌ Geocoding system error:", error);
    return null;
  }
};