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
          // Include existing delivery requests to check if we already notified them
          deliveryRequests: {
            where: { deliveryId: delivery.id },
          },
        },
      });

      if (availableRiders.length === 0) continue;

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
            // Check if a delivery request record already exists for this rider & delivery
            alreadyNotified: rider.deliveryRequests.length > 0,
          };
        })
        .filter((rider) => {
          if (rider.hasActiveDelivery) {
            const PROXIMITY_THRESHOLD_KM = 2.0;
            if (rider.distanceFromPickup > PROXIMITY_THRESHOLD_KM) return false;
          }
          return true;
        })
        .sort((a, b) => a.distanceFromPickup - b.distanceFromPickup)
        .slice(0, 5);

      for (const rider of nextBatchRiders) {
        try {
          // Upsert the delivery request record
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

          // 🛑 SMART CHECK: Only send a push/in-app notification if they HAVEN'T been notified for this delivery yet
          if (!rider.alreadyNotified && rider.userId) {
            const message = rider.hasActiveDelivery
              ? `A nearby delivery is on your current route (${rider.distanceFromPickup.toFixed(1)} km away).`
              : `Package (${delivery.trackingId}) is available near you (${rider.distanceFromPickup.toFixed(1)} km away).`;

            await sendNotification({
              userId: rider.userId,
              title: "New Delivery Available 📦",
              message,
              type: "DELIVERY",
            });
            console.log(`📲 Notification sent to rider ${rider.id} for delivery ${delivery.trackingId}`);
          } else {
            console.log(`🔕 Skipping duplicate notification for rider ${rider.id} (already notified).`);
          }
        } catch (riderErr) {
          console.error(`❌ Failed to process delivery request for rider ${rider.id}:`, riderErr.message);
        }
      }
    }
  } catch (error) {
    console.error("❌ Error in pollUnassignedDeliveries repoll job:", error);
  }
};