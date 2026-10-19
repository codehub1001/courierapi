
/**
 * Calculates a transparent Swiftbox bike-delivery quote.
 *
 * Existing rates are preserved initially.
 * Add zone/parcel adjustments only when supported by your
 * actual rider costs and operating data.
 */
export const calculateDeliveryFee = ({
  distanceInKm = 0,
  isPeakHour = false,
  zoneSurcharge = 0,
}) => {
  const BASE_FARE = 1500;
  const SYSTEM_FEE = 600;
  const RATE_PER_KM = 200;
  const PEAK_MULTIPLIER = 1.15;
  const MINIMUM_RIDER_FARE = 1500;
  const ROUNDING_UNIT = 100;

  // Validate road distance.
  if (
    typeof distanceInKm !== "number" ||
    !Number.isFinite(distanceInKm) ||
    distanceInKm < 0
  ) {
    throw new Error("A valid road distance is required.");
  }

  if (
    typeof zoneSurcharge !== "number" ||
    !Number.isFinite(zoneSurcharge) ||
    zoneSurcharge < 0
  ) {
    throw new Error("Zone surcharge must be a valid non-negative amount.");
  }

  const roundUp = (amount) =>
    Math.ceil(amount / ROUNDING_UNIT) * ROUNDING_UNIT;

  const distanceCost = distanceInKm * RATE_PER_KM;

  // Apply route and demand adjustments before rounding.
  const prePeakRiderFare =
    BASE_FARE + distanceCost + zoneSurcharge;

  const peakAdjustment = isPeakHour
    ? prePeakRiderFare * (PEAK_MULTIPLIER - 1)
    : 0;

  const riderFee = roundUp(
    Math.max(
      MINIMUM_RIDER_FARE,
      prePeakRiderFare + peakAdjustment
    )
  );

  const totalFare = riderFee + SYSTEM_FEE;

  return {
    baseFare: BASE_FARE,
    distanceCost: Math.round(distanceCost),
    zoneSurcharge,
    peakAdjustment: Math.round(peakAdjustment),
    distanceInKm: Number(distanceInKm.toFixed(2)),
    systemFee: SYSTEM_FEE,
    riderFee,
    totalFare,
    currency: "NGN",
  };
};
