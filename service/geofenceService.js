// services/geofenceService.js
import prisma from "../prismaClient.js";
import { getDistanceInMeters } from "../utils/geofence.js";
import { sendNotification } from "../utils/sendNotification.js";

export const processDeliveryGeofences = async (riderId, currentLat, currentLon) => {
  try {
    // 1. Fetch active IN_TRANSIT delivery assigned to this rider
    const activeDelivery = await prisma.delivery.findFirst({
      where: {
        riderId,
        status: "IN_TRANSIT",
      },
    });

    if (!activeDelivery || !activeDelivery.recipientLatitude || !activeDelivery.recipientLongitude) {
      return;
    }

    // 2. Calculate distance to recipient in meters
    const distanceMeters = getDistanceInMeters(
      currentLat,
      currentLon,
      activeDelivery.recipientLatitude,
      activeDelivery.recipientLongitude
    );

    if (distanceMeters === null) return;

    // ────────────────────────────────────────────────────────
    // GEOFENCE 1: 500 METERS (Approach Alert)
    // ────────────────────────────────────────────────────────
    if (distanceMeters <= 500 && !activeDelivery.notified500m) {
      // Mark as notified immediately to prevent duplicate triggers
      await prisma.delivery.update({
        where: { id: activeDelivery.id },
        data: { notified500m: true },
      });

      // Send Notification to Recipient
      const message = `CourierX Alert: Your rider is approaching! Package (${activeDelivery.trackingId}) is about 500m away. Please prepare to receive it.`;
      
      await sendNotification(activeDelivery.recipientPhone, message);

      // Create internal notification record for Vendor
      await prisma.notification.create({
        data: {
          userId: activeDelivery.vendorId,
          deliveryId: activeDelivery.id,
          title: "Rider Approaching",
          message: `Rider is within 500 meters of recipient (${activeDelivery.recipientName}).`,
        },
      });
    }

    // ────────────────────────────────────────────────────────
    // GEOFENCE 2: 50 METERS (Arrival & Delivery PIN Delivery)
    // ────────────────────────────────────────────────────────
    if (distanceMeters <= 50 && !activeDelivery.notifiedArrived) {
      // Mark as arrived to lock this trigger
      await prisma.delivery.update({
        where: { id: activeDelivery.id },
        data: { notifiedArrived: true },
      });

      // Send Delivery PIN and Arrival Alert to Recipient
      const pinMessage = `CourierX Arrival: Your rider has arrived outside! Hand over PIN: ${activeDelivery.deliveryPin} to the rider to collect your package (${activeDelivery.trackingId}).`;

      await sendNotification(activeDelivery.recipientPhone, pinMessage);

      // Create internal notification record for Vendor
      await prisma.notification.create({
        data: {
          userId: activeDelivery.vendorId,
          deliveryId: activeDelivery.id,
          title: "Rider Arrived",
          message: `Rider is outside recipient location. Delivery PIN sent to recipient.`,
        },
      });
    }
  } catch (error) {
    console.error("Geofence Evaluation Error:", error);
  }
};