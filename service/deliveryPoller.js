import prisma from "../prismaClient.js";; // adjust your prisma import path
import { sendNotification } from "../utils/sendNotification.js"; // adjust your notification service path

// Haversine distance formula for rider proximity
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

export const pollUnassignedDeliveries = async () => {
  try {
    console.log("🔄 Running background poll for unassigned PENDING deliveries...");

    // 1. Find deliveries that are still PENDING and have no rider assigned
    const pendingDeliveries = await prisma.delivery.findMany({
      where: {
        status: "PENDING",
        riderId: null,
      },
    });

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    for (const delivery of pendingDeliveries) {
      // Check if it has been sitting in PENDING for over 5 minutes
      if (new Date(delivery.createdAt) <= fiveMinutesAgo) {
        console.log(`📦 Repolling riders for stagnant delivery: ${delivery.trackingId}`);

        // 2. Expire any old pending requests for this delivery so they disappear from rider feeds
        await prisma.deliveryRequest.updateMany({
          where: {
            deliveryId: delivery.id,
            status: "PENDING",
          },
          data: {
            status: "EXPIRED",
          },
        });

        // 3. Find available verified riders who DON'T already have an active request for this delivery
        const availableRiders = await prisma.riderProfile.findMany({
          where: {
            isVerified: true,
            isAvailable: true,
            currentLatitude: { not: null },
            currentLongitude: { not: null },
            deliveries: {
              none: {
                status: {
                  in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"],
                },
              },
            },
            deliveryRequests: {
              none: {
                deliveryId: delivery.id,
              },
            },
          },
          include: {
            user: { select: { id: true, fullName: true, phone: true } },
          },
        });

        if (availableRiders.length === 0) {
          console.log(`⚠️ No new available riders found for delivery ${delivery.trackingId}`);
          continue;
        }

        // 4. Sort riders by distance to pickup location
        const ridersWithDistance = availableRiders
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

        const nextBatchRiders = ridersWithDistance.slice(0, 5);

        // 5. Create fresh delivery requests for the next batch (linking to the SAME delivery ID)
        await prisma.deliveryRequest.createMany({
          data: nextBatchRiders.map((rider) => ({
            deliveryId: delivery.id,
            riderId: rider.id,
            status: "PENDING",
            distanceFromPickup: rider.distanceFromPickup,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          })),
        });

        // 6. Notify the new batch of riders
        await Promise.all(
          nextBatchRiders.map((rider) =>
            sendNotification({
              userId: rider.userId,
              title: "New Delivery Available 📦",
              message: `Package (${delivery.trackingId}) is still waiting near you (${rider.distanceFromPickup.toFixed(1)} km away).`,
              type: "DELIVERY",
            })
          )
        );

        console.log(`✅ Re-broadcasted delivery ${delivery.trackingId} to ${nextBatchRiders.length} new riders.`);
      }
    }
  } catch (error) {
    console.error("❌ Error in pollUnassignedDeliveries background job:", error);
  }
};