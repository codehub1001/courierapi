/**
 * Calculates delivery fare for dispatch bikes.
 *
 * Vendor sees:
 *   totalFare
 *
 * Rider sees:
 *   riderFee
 *
 * CourierX keeps:
 *   systemFee
 *
 * @param {Object} params
 * @param {number} params.distanceInKm
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

  // ---------------------------------------------
  // DISTANCE COST
  // ---------------------------------------------

  const distanceCost =
    distanceInKm * RATE_PER_KM;

  // ---------------------------------------------
  // RIDER FEE BEFORE SURGE
  // ---------------------------------------------

  let riderFeeRaw =
    BASE_FARE + distanceCost;

  // ---------------------------------------------
  // PEAK HOUR SURGE
  // ---------------------------------------------

  if (isPeakHour) {
    riderFeeRaw *= 1.15;
  }

  // ---------------------------------------------
  // ROUND RIDER FEE TO NEAREST ₦100
  // ---------------------------------------------

  const riderFee =
    Math.ceil(riderFeeRaw / 100) * 100;

  // ---------------------------------------------
  // TOTAL VENDOR PRICE
  // ---------------------------------------------

  const totalFareRaw =
    riderFee + SYSTEM_FEE;

  const totalFare =
    Math.ceil(totalFareRaw / 100) * 100;

  return {
    baseFare: BASE_FARE,

    distanceCost: Math.round(distanceCost),

    distanceInKm: Number(
      distanceInKm.toFixed(2)
    ),

    systemFee: SYSTEM_FEE,

    // Amount rider earns
    riderFee,

    // Total amount vendor pays
    totalFare,

    currency: "NGN",
  };
};