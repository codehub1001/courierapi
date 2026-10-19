
import { geocodeAddress } from "../utils/geocoding.js";
import { getRoadRoute } from "../utils/routing.js";
import { calculateDeliveryFee } from "../utils/pricing.js";

export const estimateFare = async (req, res) => {
  try {
    const {
      pickupAddress,
      destinationAddress,
      isPeakHour = false,
    } = req.body;

    // 1. Validate addresses
    if (
      typeof pickupAddress !== "string" ||
      typeof destinationAddress !== "string" ||
      !pickupAddress.trim() ||
      !destinationAddress.trim()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Valid pickup and destination addresses are required.",
      });
    }

    // Never coerce strings such as "false" into true.
    if (typeof isPeakHour !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Invalid peak-hour setting.",
      });
    }

    // 2. Geocode pickup
    const pickup = await geocodeAddress(
      pickupAddress.trim()
    );

    if (!pickup) {
      return res.status(400).json({
        success: false,
        message:
          "Unable to locate pickup. Please check the address.",
      });
    }

    // 3. Geocode destination
    const destination = await geocodeAddress(
      destinationAddress.trim()
    );

    if (!destination) {
      return res.status(400).json({
        success: false,
        message:
          "Unable to locate destination. Please check the address.",
      });
    }

    // 4. Reject approximate coordinates
    if (
      pickup.isApproximate ||
      destination.isApproximate ||
      pickup.precision === "AREA" ||
      destination.precision === "AREA"
    ) {
      return res.status(422).json({
        success: false,
        code: "ADDRESS_NEEDS_CONFIRMATION",
        message:
          "Please provide a more specific pickup and destination address.",
        pickupPrecision: pickup.precision,
        destinationPrecision: destination.precision,
      });
    }

    // 5. Validate geocoded coordinates
    const validCoordinates = (location) =>
      Number.isFinite(location.latitude) &&
      Number.isFinite(location.longitude) &&
      location.latitude >= -90 &&
      location.latitude <= 90 &&
      location.longitude >= -180 &&
      location.longitude <= 180;

    if (
      !validCoordinates(pickup) ||
      !validCoordinates(destination)
    ) {
      return res.status(422).json({
        success: false,
        message:
          "Invalid location coordinates. Please verify the addresses.",
      });
    }

    // 6. Calculate actual road route using OSRM
    const route = await getRoadRoute(
      pickup.latitude,
      pickup.longitude,
      destination.latitude,
      destination.longitude
    );

    if (
      !route ||
      !Number.isFinite(route.distanceMeters) ||
      route.distanceMeters <= 0 ||
      !Number.isFinite(route.durationSeconds) ||
      route.durationSeconds < 0
    ) {
      return res.status(422).json({
        success: false,
        message:
          "Unable to verify a valid road route. Please check both addresses.",
      });
    }

    // 7. Convert meters to kilometers
    const distanceInKm = route.distanceMeters / 1000;

    if (!Number.isFinite(distanceInKm) || distanceInKm <= 0) {
      return res.status(422).json({
        success: false,
        message: "Unable to verify delivery distance.",
      });
    }

    // 8. Calculate the fare using existing rates
    const pricingBreakdown = calculateDeliveryFee({
      distanceInKm,
      isPeakHour,
    });

    // 9. Return the verified quote
    return res.status(200).json({
      success: true,
      ...pricingBreakdown,

      route: {
        distanceKm: Number(distanceInKm.toFixed(2)),
        durationMinutes: Math.ceil(
          route.durationSeconds / 60
        ),
      },

      locations: {
        pickup: {
          latitude: pickup.latitude,
          longitude: pickup.longitude,
          displayName: pickup.displayName,
          precision: pickup.precision,
        },

        destination: {
          latitude: destination.latitude,
          longitude: destination.longitude,
          displayName: destination.displayName,
          precision: destination.precision,
        },
      },
    });
  } catch (error) {
    console.error("Fare estimation error:", error);

    return res.status(500).json({
      success: false,
      message:
        "Failed to calculate estimated fare. Please try again.",
    });
  }
};
