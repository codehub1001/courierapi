import { geocodeAddress } from "../utils/geocoding.js";
import { getRoadRoute } from "../utils/routing.js";
import { calculateDeliveryFee } from "../utils/pricing.js";

export const estimateFare = async (req, res) => {
  try {
    const {
      pickupAddress,
      destinationAddress,
      isPeakHour,
    } = req.body;

    if (!pickupAddress || !destinationAddress) {
      return res.status(400).json({
        success: false,
        message: "Pickup and destination addresses are required.",
      });
    }

    // Geocode pickup
    const pickup = await geocodeAddress(pickupAddress);

    if (!pickup) {
      return res.status(400).json({
        success: false,
        message: "Unable to locate pickup address.",
      });
    }

    // Geocode destination
    const destination = await geocodeAddress(destinationAddress);

    if (!destination) {
      return res.status(400).json({
        success: false,
        message: "Unable to locate destination address.",
      });
    }

    // Don't price using approximate AREA coordinates
    if (
      pickup.isApproximate ||
      destination.isApproximate
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Please provide more specific pickup and destination addresses.",
        pickupPrecision: pickup.precision,
        destinationPrecision: destination.precision,
      });
    }

    // Get actual ROAD distance
    const route = await getRoadRoute(
      pickup.latitude,
      pickup.longitude,
      destination.latitude,
      destination.longitude
    );

    if (!route) {
      return res.status(400).json({
        success: false,
        message:
          "Unable to calculate a road route between these locations.",
      });
    }

    // Convert meters to kilometers
    const distanceInKm =
      route.distanceMeters / 1000;

    // Calculate CourierX price
    const pricingBreakdown = calculateDeliveryFee({
      distanceInKm,
      isPeakHour: Boolean(isPeakHour),
    });

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
        },

        destination: {
          latitude: destination.latitude,
          longitude: destination.longitude,
          displayName: destination.displayName,
        },
      },
    });
  } catch (error) {
    console.error("Fare estimation error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to calculate estimated fare.",
    });
  }
};