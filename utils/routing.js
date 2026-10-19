
/**
 * utils/routing.js
 *
 * Road routing for Swiftbox delivery estimates and map display.
 * Uses OSRM's public demo server by default.
 */

const OSRM_BASE_URL = "https://router.project-osrm.org";

const isValidCoordinate = (latitude, longitude) =>
  typeof latitude === "number" &&
  typeof longitude === "number" &&
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

/**
 * Get the road route between pickup and destination.
 *
 * @param {number} pickupLatitude
 * @param {number} pickupLongitude
 * @param {number} destinationLatitude
 * @param {number} destinationLongitude
 *
 * @returns {Promise<{
 *   distanceMeters: number,
 *   durationSeconds: number,
 *   coordinates: [number, number][]
 * }|null>}
 *
 * coordinates are returned as [latitude, longitude] for Leaflet.
 */
export const getRoadRoute = async (
  pickupLatitude,
  pickupLongitude,
  destinationLatitude,
  destinationLongitude
) => {
  try {
    if (
      !isValidCoordinate(pickupLatitude, pickupLongitude) ||
      !isValidCoordinate(destinationLatitude, destinationLongitude)
    ) {
      console.warn("Invalid coordinates supplied to road routing.");
      return null;
    }

    // Avoid routing a point to itself.
    if (
      pickupLatitude === destinationLatitude &&
      pickupLongitude === destinationLongitude
    ) {
      console.warn("Pickup and destination coordinates are identical.");
      return null;
    }

    // OSRM expects longitude,latitude.
    const coordinates = [
      `${pickupLongitude},${pickupLatitude}`,
      `${destinationLongitude},${destinationLatitude}`,
    ].join(";");

    const params = new URLSearchParams({
      overview: "full",
      geometries: "geojson",
      steps: "false",
    });

    const url =
      `${OSRM_BASE_URL}/route/v1/driving/${coordinates}?${params}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error("OSRM HTTP error:", response.status);
      return null;
    }

    const data = await response.json();

    if (
      data.code !== "Ok" ||
      !Array.isArray(data.routes) ||
      data.routes.length === 0
    ) {
      console.warn("OSRM could not find a valid driving route:", data.code);
      return null;
    }

    const route = data.routes[0];

    const distanceMeters = Number(route.distance);
    const rawDurationSeconds = Number(route.duration);

    if (
      !Number.isFinite(distanceMeters) ||
      distanceMeters <= 0 ||
      !Number.isFinite(rawDurationSeconds) ||
      rawDurationSeconds <= 0
    ) {
      console.warn("OSRM returned invalid distance or duration.");
      return null;
    }

    const routeCoordinates = route.geometry?.coordinates;

    if (!Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      console.warn("OSRM returned incomplete route geometry.");
      return null;
    }

    const coordinatesForLeaflet = routeCoordinates.map((point) => {
      if (!Array.isArray(point) || point.length < 2) {
        return null;
      }

      const [longitude, latitude] = point;

      if (!isValidCoordinate(latitude, longitude)) {
        return null;
      }

      return [latitude, longitude];
    });

    if (coordinatesForLeaflet.some((point) => point === null)) {
      console.warn("OSRM returned invalid geometry coordinates.");
      return null;
    }

    // A buffer is a planning estimate, not a live traffic prediction.
    const DURATION_BUFFER_MULTIPLIER = 1.6;
    const durationSeconds = Math.ceil(
      rawDurationSeconds * DURATION_BUFFER_MULTIPLIER
    );

    return {
      distanceMeters,
      durationSeconds,
      coordinates: coordinatesForLeaflet,
    };
  } catch (error) {
    console.error("Road routing error:", error);
    return null;
  }
};
