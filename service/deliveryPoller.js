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
    console.log("🔄 Running repoll background job for unassigned PENDING deliveries...");

    const pendingDeliveries = await prisma.delivery.findMany({
      where: {
        status: "PENDING",
        riderId: null,
      },
    });

    console.log(`📦 Found ${pendingDeliveries.length} unassigned pending deliveries to process.`);

    for (const delivery of pendingDeliveries) {
      const availableRiders = await prisma.riderProfile.findMany({
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
        },
      });

      console.log(`👥 Total riders found in DB: ${availableRiders.length}`);

      if (availableRiders.length === 0) {
        console.log(`⚠️ No riders exist in the RiderProfile table at all!`);
        continue;
      }

      const nextBatchRiders = availableRiders
        .map((rider) => {
          const lat = rider.currentLatitude ?? delivery.pickupLatitude;
          const lon = rider.currentLongitude ?? delivery.pickupLongitude;
          return {
            ...rider,
            distanceFromPickup: calculateHaversine(
              delivery.pickupLatitude,
              delivery.pickupLongitude,
              lat,
              lon
            ),
          };
        })
        .sort((a, b) => a.distanceFromPickup - b.distanceFromPickup)
        .slice(0, 5);

      for (const rider of nextBatchRiders) {
        try {
          // Use upsert so it updates or creates the request cleanly without constraint crashes
          await prisma.deliveryRequest.upsert({
            where: {
              deliveryId_riderId: {
                deliveryId: delivery.id,
                riderId: rider.id,
              },
            },
            update: {
              status: "PENDING",
              distanceFromPickup: rider.distanceFromPickup,
              expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
            create: {
              deliveryId: delivery.id,
              riderId: rider.id,
              status: "PENDING",
              distanceFromPickup: rider.distanceFromPickup,
              expiresAt: new Date(Date.now() + 5 * 60 * 1000),
            },
          });

          // Send notification for each successfully processed rider
          if (rider.userId) {
            await sendNotification({
              userId: rider.userId,
              title: "New Delivery Available 📦",
              message: `Package (${delivery.trackingId}) is available near you.`,
              type: "DELIVERY",
            });
          }
        } catch (riderErr) {
          console.error(`❌ Failed to create delivery request for rider ${rider.id}:`, riderErr.message);
        }
      }

      console.log(`✅ Successfully processed delivery ${delivery.trackingId} for ${nextBatchRiders.length} riders.`);
    }
  } catch (error) {
    console.error("❌ Error in pollUnassignedDeliveries repoll job:", error);
  }
};