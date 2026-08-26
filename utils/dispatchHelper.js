import prisma from "../prismaClient.js";
import { sendNotification } from "./sendNotification.js";

const calculateHaversine = (lat1, lon1, lat2, lon2) => {
  const earthRadius = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return earthRadius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

export const dispatchDeliveryToNearbyRiders = async (delivery) => {
  try {
    // Expire any old pending requests for this delivery
    await prisma.deliveryRequest.updateMany({
      where: { deliveryId: delivery.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });

    // 1. Fetch available riders (we now include their active deliveries to check route proximity programmatically)
    const riders = await prisma.riderProfile.findMany({
      where: {
        isVerified: true,
        isAvailable: true,
        currentLatitude: { not: null },
        currentLongitude: { not: null },
        deliveryRequests: {
          none: { deliveryId: delivery.id },
        },
      },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
        deliveries: {
          where: {
            status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] },
          },
          select: {
            id: true,
            status: true,
            recipientLatitude: true,
            recipientLongitude: true,
          },
        },
      },
    });

    if (riders.length === 0) return [];

    // 2. Filter and calculate distances
    const processedRiders = riders
      .map((rider) => {
        const distanceFromPickup = calculateHaversine(
          delivery.pickupLatitude,
          delivery.pickupLongitude,
          rider.currentLatitude,
          rider.currentLongitude
        );

        return {
          ...rider,
          distanceFromPickup,
          hasActiveDelivery: rider.deliveries.length > 0,
          activeDelivery: rider.deliveries[0] || null,
        };
      })
      .filter((rider) => {
        // If the rider has NO active delivery, standard proximity applies (e.g., within a reasonable radius like 10km)
        if (!rider.hasActiveDelivery) {
          return true; 
        }

        // If the rider HAS an active delivery, ONLY include them if:
        // 1. They are extremely close to the new pickup point (e.g., within 2 km of where they are right now)
        const PROXIMITY_THRESHOLD_KM = 2.0; 
        
        return rider.distanceFromPickup <= PROXIMITY_THRESHOLD_KM;
      })
      .sort((a, b) => a.distanceFromPickup - b.distanceFromPickup);

    const closestRiders = processedRiders.slice(0, 5);

    if (closestRiders.length === 0) return [];

    await prisma.deliveryRequest.createMany({
      data: closestRiders.map((rider) => ({
        deliveryId: delivery.id,
        riderId: rider.id,
        status: "PENDING",
        distanceFromPickup: rider.distanceFromPickup,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      })),
    });

    await Promise.all(
      closestRiders.map((rider) =>
        sendNotification({
          userId: rider.userId,
          title: "New Delivery Available 📦",
          message: rider.hasActiveDelivery
            ? `A nearby delivery is on your current route (${rider.distanceFromPickup.toFixed(1)} km away).`
            : `A new package (${delivery.trackingId}) is available near you (${rider.distanceFromPickup.toFixed(1)} km away).`,
          type: "DELIVERY",
        })
      )
    );

    return closestRiders;
  } catch (error) {
    console.error("❌ Error in dispatchDeliveryToNearbyRiders:", error);
    return [];
  }
};