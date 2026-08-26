/**
 * Calculates delivery fare for dispatch bikes based on exact road distance.
 *
 * @param {Object} params
 * @param {number} params.distanceInKm - Exact road distance in kilometers
 * @param {boolean} params.isPeakHour
 * @returns {Object} Fare breakdown
 */
export const calculateDeliveryFee = ({
  distanceInKm = 0,
  isPeakHour = false,
}) => {
  const BASE_FARE = 1500;
  const SYSTEM_FEE = 600;
  const RATE_PER_KM = 300;

  const distanceCost = distanceInKm * RATE_PER_KM;
  let riderFeeRaw = BASE_FARE + distanceCost;

  if (isPeakHour) {
    riderFeeRaw *= 1.15;
  }

  const riderFee = Math.ceil(riderFeeRaw / 100) * 100;
  const totalFareRaw = riderFee + SYSTEM_FEE;
  const totalFare = Math.ceil(totalFareRaw / 100) * 100;

  return {
    baseFare: BASE_FARE,
    distanceCost: Math.round(distanceCost),
    distanceInKm: Number(distanceInKm.toFixed(2)),
    systemFee: SYSTEM_FEE,
    riderFee,
    totalFare,
    currency: "NGN",
  };
};