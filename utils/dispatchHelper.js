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

    const riders = await prisma.riderProfile.findMany({
      where: {
        isVerified: true,
        isAvailable: true,
        currentLatitude: { not: null },
        currentLongitude: { not: null },
        deliveries: {
          none: { status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] } },
        },
        deliveryRequests: {
          none: { deliveryId: delivery.id },
        },
      },
      include: {
        user: { select: { id: true, fullName: true, phone: true } },
      },
    });

    if (riders.length === 0) return [];

    const ridersWithDistance = riders
      .map((rider) => ({
        ...rider,
        distanceFromPickup: calculateHaversine(
          delivery.pickupLatitude,
          delivery.pickupLongitude,
          rider.currentLatitude,
          rider.currentLongitude
        ),
      }))
      .sort((a, b) => a.distanceFromPickup - b.distanceFromPickup);

    const closestRiders = ridersWithDistance.slice(0, 5);

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
          message: `A new package (${delivery.trackingId}) is available near you (${rider.distanceFromPickup.toFixed(1)} km away).`,
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