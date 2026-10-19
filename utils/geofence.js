
/**
 * utils/geofence.js
 *
 * Geographic utilities for Swiftbox.
 * Distances are calculated using the Haversine formula.
 */

/**
 * Validate latitude and longitude.
 */
export const isValidCoordinate = (latitude, longitude) => {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
};

/**
 * Calculates the great-circle distance between two GPS coordinates.
 *
 * @returns {number|null} Distance in meters, or null for invalid input.
 */
export const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  if (
    !isValidCoordinate(lat1, lon1) ||
    !isValidCoordinate(lat2, lon2)
  ) {
    return null;
  }

  const EARTH_RADIUS_METERS = 6_371_000;

  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(deltaLambda / 2) ** 2;

  // Protect against floating-point rounding outside [0, 1].
  const safeA = Math.min(1, Math.max(0, a));
  const centralAngle =
    2 * Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA));

  return EARTH_RADIUS_METERS * centralAngle;
};

/**
 * Broad geographic guard around the Lagos delivery region.
 *
 * IMPORTANT:
 * This rectangle is not a precise Lagos delivery-zone boundary.
 * Replace it with a verified polygon if you need exact coverage.
 */
const LAGOS_BOUNDS = {
  minLatitude: 6.30,
  maxLatitude: 6.90,
  minLongitude: 2.65,
  maxLongitude: 4.30,
};

/**
 * Checks whether a coordinate falls within the broad Lagos bounds.
 */
export const isWithinLagosBounds = (latitude, longitude) => {
  if (!isValidCoordinate(latitude, longitude)) {
    return false;
  }

  return (
    latitude >= LAGOS_BOUNDS.minLatitude &&
    latitude <= LAGOS_BOUNDS.maxLatitude &&
    longitude >= LAGOS_BOUNDS.minLongitude &&
    longitude <= LAGOS_BOUNDS.maxLongitude
  );
};

/**
 * Checks whether two coordinates are within a specified radius.
 *
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @param {number} radiusMeters
 * @returns {boolean}
 */
export const areCoordinatesWithinRadius = (
  lat1,
  lon1,
  lat2,
  lon2,
  radiusMeters
) => {
  if (
    typeof radiusMeters !== "number" ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters < 0
  ) {
    return false;
  }

  const distance = getDistanceInMeters(lat1, lon1, lat2, lon2);

  return distance !== null && distance <= radiusMeters;
};
