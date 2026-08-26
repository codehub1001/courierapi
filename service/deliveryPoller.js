import prisma from "../prismaClient.js";
import { sendNotification } from "../utils/sendNotification.js";

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

    const pendingDeliveries = await prisma.delivery.findMany({
      where: {
        status: "PENDING",
        riderId: null,
      },
    });

    console.log(`📦 Found ${pendingDeliveries.length} total unassigned pending deliveries in DB.`);

    const now = Date.now();
    const fiveMinutesAgo = new Date(now - 5 * 60 * 1000);
    const maxExpirationAge = new Date(now - 45 * 60 * 1000); // Stop broadcasting after 45 mins

    for (const delivery of pendingDeliveries) {
      const createdAt = new Date(delivery.createdAt);

      // Stop polling completely if the delivery is older than 45 minutes to prevent infinite loops
      if (createdAt <= maxExpirationAge) {
        console.log(`⌛ Delivery ${delivery.trackingId} exceeded max broadcast window. Marking as EXPIRED.`);
        await prisma.delivery.update({
          where: { id: delivery.id },
          data: { status: "EXPIRED" },
        });
        continue;
      }

      if (createdAt <= fiveMinutesAgo) {
        console.log(`⏱️ Delivery ${delivery.trackingId} passed the 5-minute age check.`);

        // Expire old pending requests
        await prisma.deliveryRequest.updateMany({
          where: {
            deliveryId: delivery.id,
            status: "PENDING",
          },
          data: {
            status: "EXPIRED",
          },
        });

        // Find available verified riders
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
                status: "PENDING",
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

        // Sort and slice next batch
        const nextBatchRiders = availableRiders
          .map((rider) => ({
            ...rider,
            distanceFromPickup: calculateHaversine(
              delivery.pickupLatitude,
              delivery.pickupLongitude,
              rider.currentLatitude,
              rider.currentLongitude
            ),
          }))
          .sort((a, b) => a.distanceFromPickup - b.distanceFromPickup)
          .slice(0, 5);

        if (nextBatchRiders.length === 0) continue;

        // Create fresh delivery requests
        await prisma.deliveryRequest.createMany({
          data: nextBatchRiders.map((rider) => ({
            deliveryId: delivery.id,
            riderId: rider.id,
            status: "PENDING",
            distanceFromPickup: rider.distanceFromPickup,
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          })),
          skipDuplicates: true,
        });

        // Notify riders
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
      } else {
        console.log(`⏳ Delivery ${delivery.trackingId} is too fresh. Skipping.`);
      }
    }
  } catch (error) {
    console.error("❌ Error in pollUnassignedDeliveries background job:", error);
  }
};