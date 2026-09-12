export const getRoadRoute = async (
  pickupLatitude,
  pickupLongitude,
  destinationLatitude,
  destinationLongitude
) => {
  try {
    const coordinates = [
      `${pickupLongitude},${pickupLatitude}`,
      `${destinationLongitude},${destinationLatitude}`,
    ].join(";");

    // Request full GeoJSON geometries so Leaflet can draw actual street turns
    const url =
      `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
      `?overview=full&geometries=geojson&steps=false`;

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "CourierX Delivery Platform",
      },
    });

    if (!response.ok) {
      console.error("OSRM error:", response.status);
      return null;
    }

    const data = await response.json();

    if (
      data.code !== "Ok" ||
      !data.routes ||
      data.routes.length === 0
    ) {
      return null;
    }

    const route = data.routes[0];
    const bufferedDurationSeconds = route.duration * 1.6;

    return {
      distanceMeters: route.distance,
      durationSeconds: bufferedDurationSeconds,
      // OSRM returns coordinates as [longitude, latitude], Leaflet needs [latitude, longitude]
      coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    };
  } catch (error) {
    console.error("Road routing error:", error);
    return null;
  }
};