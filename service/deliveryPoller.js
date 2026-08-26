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
      // Fetch riders along with their active deliveries to check route proximity
      const availableRiders = await prisma.riderProfile.findMany({
        where: {
          isVerified: true,
          isAvailable: true,
        },
        include: {
          user: { select: { id: true, fullName: true, phone: true } },
          deliveries: {
            where: {
              status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] },
            },
            select: { id: true, status: true },
          },
        },
      });

      console.log(`👥 Total verified/available riders found in DB: ${availableRiders.length}`);

      if (availableRiders.length === 0) {
        console.log(`⚠️ No available riders exist in the RiderProfile table at all!`);
        continue;
      }

      // Filter and calculate distances with active delivery & route consideration
      const nextBatchRiders = availableRiders
        .map((rider) => {
          const lat = rider.currentLatitude ?? delivery.pickupLatitude;
          const lon = rider.currentLongitude ?? delivery.pickupLongitude;
          const distanceFromPickup = calculateHaversine(
            delivery.pickupLatitude,
            delivery.pickupLongitude,
            lat,
            lon
          );

          return {
            ...rider,
            distanceFromPickup,
            hasActiveDelivery: rider.deliveries.length > 0,
          };
        })
        .filter((rider) => {
          // If the rider has NO active delivery, they are valid
          if (!rider.hasActiveDelivery) return true;

          // If the rider HAS an active delivery, ONLY include them if they are extremely close (e.g., within 2 km)
          const PROXIMITY_THRESHOLD_KM = 2.0;
          return rider.distanceFromPickup <= PROXIMITY_THRESHOLD_KM;
        })
        .sort((a, b) => a.distanceFromPickup - b.distanceFromPickup)
        .slice(0, 5);

      if (nextBatchRiders.length === 0) {
        console.log(`⚠️ No eligible riders found for delivery ${delivery.trackingId} (riders are either busy or out of range).`);
        continue;
      }

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
            const message = rider.hasActiveDelivery
              ? `A nearby delivery is on your current route (${rider.distanceFromPickup.toFixed(1)} km away).`
              : `Package (${delivery.trackingId}) is available near you (${rider.distanceFromPickup.toFixed(1)} km away).`;

            await sendNotification({
              userId: rider.userId,
              title: "New Delivery Available 📦",
              message,
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