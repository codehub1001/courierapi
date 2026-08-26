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

    const url =
      `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
      `?overview=false&steps=false`;

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

    // Apply a buffer multiplier (e.g., 1.6x) for city traffic, stops, and realistic riding speeds
    const bufferedDurationSeconds = route.duration * 1.6;

    return {
      distanceMeters: route.distance,
      durationSeconds: bufferedDurationSeconds,
    };
  } catch (error) {
    console.error("Road routing error:", error);
    return null;
  }
};