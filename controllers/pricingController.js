import { calculateDeliveryFee } from "../utils/pricing.js";

export const estimateFare = async (req, res) => {
  try {
    const { distanceInKm, isPeakHour } = req.body;

    if (distanceInKm === undefined || distanceInKm < 0) {
      return res.status(400).json({
        success: false,
        message: "Valid distance in kilometers is required.",
      });
    }

    const pricingBreakdown = calculateDeliveryFee({
      distanceInKm: Number(distanceInKm),
      isPeakHour: Boolean(isPeakHour),
    });

    return res.status(200).json({
      success: true,
      ...pricingBreakdown,
    });
  } catch (error) {
    console.error("Fare estimation error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate estimated fare.",
    });
  }
};