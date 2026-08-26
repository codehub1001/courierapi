/**
 * Geocodes a text address string to geographic coordinates with precision metadata.
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

    const fetchNominatim = async (queryString) => {
      let formattedQuery = queryString;
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

    let geocodeResult = await fetchNominatim(queryAddress);

    if (!geocodeResult) {
      console.log("⚠️ Exact match failed. Attempting cleanup for:", queryAddress);

      const cleanedAddress = queryAddress
        .replace(/^(no\.?\s*|flat\s*\d+\s*,?|unit\s*\d+\s*,?|suite\s*\d+\s*,?|block\s*[a-z0-9]+\s*,?)?/i, "")
        .replace(/^\d+[a-z]?[\s,]+/i, "")
        .trim();

      if (cleanedAddress && cleanedAddress !== queryAddress) {
        console.log("🔍 Retrying Nominatim with cleaned street address:", cleanedAddress);
        geocodeResult = await fetchNominatim(cleanedAddress);
      }
    }

    if (!geocodeResult) {
      const lower = queryAddress.toLowerCase();
      let fallbackArea = null;

      if (lower.includes("ikeja")) fallbackArea = "Ikeja, Lagos, Nigeria";
      else if (lower.includes("lekki")) fallbackArea = "Lekki, Lagos, Nigeria";
      else if (lower.includes("surulere")) fallbackArea = "Surulere, Lagos, Nigeria";
      else if (lower.includes("yaba")) fallbackArea = "Yaba, Lagos, Nigeria";
      else if (lower.includes("ajah")) fallbackArea = "Ajah, Lagos, Nigeria";
      else if (lower.includes("vi") || lower.includes("victoria island")) fallbackArea = "Victoria Island, Lagos, Nigeria";
      else if (lower.includes("ikoyi")) fallbackArea = "Ikoyi, Lagos, Nigeria";
      else if (lower.includes("ikotun")) fallbackArea = "Ikotun, Lagos, Nigeria";
      else if (lower.includes("egbeda")) fallbackArea = "Egbeda, Lagos, Nigeria";
      else if (lower.includes("festac")) fallbackArea = "Festac Town, Lagos, Nigeria";
      else if (lower.includes("ipaja")) fallbackArea = "Ipaja, Lagos, Nigeria";
      else if (lower.includes("ogba")) fallbackArea = "Ogba, Lagos, Nigeria";
      else if (lower.includes("lagos")) fallbackArea = "Lagos, Nigeria";
      else if (lower.includes("abuja")) fallbackArea = "Abuja, FCT, Nigeria";
      else if (lower.includes("ibadan")) fallbackArea = "Ibadan, Oyo, Nigeria";
      else if (lower.includes("port harcourt") || lower.includes("ph")) fallbackArea = "Port Harcourt, Rivers, Nigeria";

      if (fallbackArea) {
        console.log("⚠️ Street level match failed. Falling back to area level:", fallbackArea);
        geocodeResult = await fetchNominatim(fallbackArea);
        if (geocodeResult) {
          geocodeResult.precision = "AREA";
          geocodeResult.isApproximate = true;
        }
      }
    }

    if (!geocodeResult) {
      console.log("⚠️ Nominatim found no coordinates for address:", queryAddress);
      return null;
    }

    return geocodeResult;

  } catch (error) {
    console.error("❌ Geocoding error:", error);
    return null;
  }
};