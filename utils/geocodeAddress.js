export const geocodeAddress = async (address) => {
  try {
    if (!address || typeof address !== "string") {
      console.warn("⚠️ Invalid address supplied for geocoding");
      return null;
    }

    let queryAddress = address.trim();

    if (!queryAddress) {
      return null;
    }

    // Helper function to execute Nominatim query
    const fetchNominatim = async (queryString) => {
      if (!queryString.toLowerCase().includes("nigeria")) {
        queryString = `${queryString}, Nigeria`;
      }

      console.log("🔍 Querying Nominatim for:", queryString);

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
          format: "json",
          q: queryString,
          countrycodes: "ng",
          limit: "1",
          addressdetails: "1",
        }).toString()}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "CourierX Delivery App",
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

      return {
        latitude,
        longitude,
        displayName: result.display_name,
        addressDetails: result.address || null,
      };
    };

    // 1. Try the full exact address first
    let geocodeResult = await fetchNominatim(queryAddress);

    // 2. If it fails, fallback by stripping specific unit/house numbers (e.g. "14b ixora" -> "ixora")
    if (!geocodeResult) {
      console.log("⚠️ Exact match failed. Attempting fallback cleanup for:", queryAddress);
      
      // Remove leading house numbers/alphanumeric tokens (e.g., "14b ", "42 ", "No 12 ")
      const cleanedAddress = queryAddress
        .replace(/^(no\.?\s*)?\d+[a-z]?[\s,]+/i, "")
        .trim();

      if (cleanedAddress && cleanedAddress !== queryAddress) {
        console.log("🔍 Retrying Nominatim with cleaned address:", cleanedAddress);
        geocodeResult = await fetchNominatim(cleanedAddress);
      }
    }

    // 3. Final fallback: fallback to general area/city level if sub-street fails entirely (e.g., fallback to Ikeja, Lagos)
    if (!geocodeResult) {
      const lower = queryAddress.toLowerCase();
      let fallbackArea = "Lagos, Nigeria";
      if (lower.includes("ikeja")) fallbackArea = "Ikeja, Lagos, Nigeria";
      else if (lower.includes("lekki")) fallbackArea = "Lekki, Lagos, Nigeria";
      else if (lower.includes("surulere")) fallbackArea = "Surulere, Lagos, Nigeria";
      else if (lower.includes("yaba")) fallbackArea = "Yaba, Lagos, Nigeria";
      else if (lower.includes("ajah")) fallbackArea = "Ajah, Lagos, Nigeria";
      else if (lower.includes("vi") || lower.includes("victoria island")) fallbackArea = "Victoria Island, Lagos, Nigeria";

      if (fallbackArea && fallbackArea !== queryAddress) {
        console.log("⚠️ Specific street not found. Falling back to area level:", fallbackArea);
        geocodeResult = await fetchNominatim(fallbackArea);
      }
    }

    if (!geocodeResult) {
      console.log("⚠️ Nominatim found no coordinates for address variants of:", queryAddress);
      return null;
    }

    console.log("✅ Geocoding successful:", {
      latitude: geocodeResult.latitude,
      longitude: geocodeResult.longitude,
      displayName: geocodeResult.displayName,
    });

    return geocodeResult;

  } catch (error) {
    console.error("❌ Geocoding fetch error:", error);
    return null;
  }
};