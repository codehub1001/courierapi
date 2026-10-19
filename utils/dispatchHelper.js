
import prisma from "../prismaClient.js";
import { sendNotification } from "./sendNotification.js";

const EARTH_RADIUS_KM = 6371;

const MAX_IDLE_RIDER_DISTANCE_KM = 10;
const MAX_BUSY_RIDER_DISTANCE_KM = 2;
const MAX_RIDERS_TO_NOTIFY = 5;
const REQUEST_EXPIRY_MINUTES = 5;

const ACTIVE_DELIVERY_STATUSES = [
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
];

const isValidCoordinate = (latitude, longitude) =>
  typeof latitude === "number" &&
  typeof longitude === "number" &&
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  latitude >= -90 &&
  latitude <= 90 &&
  longitude >= -180 &&
  longitude <= 180;

/**
 * Calculate straight-line distance between two GPS points.
 * Returns distance in kilometres or null for invalid coordinates.
 */
const calculateHaversine = (lat1, lon1, lat2, lon2) => {
  if (
    !isValidCoordinate(lat1, lon1) ||
    !isValidCoordinate(lat2, lon2)
  ) {
    return null;
  }

  const toRadians = (degrees) => (degrees * Math.PI) / 180;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(phi1) *
      Math.cos(phi2) *
      Math.sin(dLon / 2) ** 2;

  const safeA = Math.min(1, Math.max(0, a));

  return (
    EARTH_RADIUS_KM *
    2 *
    Math.atan2(Math.sqrt(safeA), Math.sqrt(1 - safeA))
  );
};

export const dispatchDeliveryToNearbyRiders = async (delivery) => {
  try {
    if (!delivery?.id) {
      console.error("Cannot dispatch: delivery ID is missing.");
      return [];
    }

    const pickupLatitude = Number(delivery.pickupLatitude);
    const pickupLongitude = Number(delivery.pickupLongitude);

    if (!isValidCoordinate(pickupLatitude, pickupLongitude)) {
      console.error(
        `Cannot dispatch delivery ${delivery.id}: invalid pickup coordinates.`
      );
      return [];
    }

    // Expire any previous pending requests for this delivery.
    await prisma.deliveryRequest.updateMany({
      where: {
        deliveryId: delivery.id,
        status: "PENDING",
        expiresAt: { lte: new Date() },
      },
      data: { status: "EXPIRED" },
    });

    // Avoid creating duplicate requests for riders already notified
    // about this delivery, including requests that were previously expired.
    const existingRequests = await prisma.deliveryRequest.findMany({
      where: { deliveryId: delivery.id },
      select: { riderId: true },
    });

    const previouslyNotifiedRiderIds = new Set(
      existingRequests.map((request) => request.riderId)
    );

    // Only verified and available riders with a known current location.
    const riders = await prisma.riderProfile.findMany({
      where: {
        isVerified: true,
        isAvailable: true,
        currentLatitude: { not: null },
        currentLongitude: { not: null },
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phone: true,
          },
        },
        deliveries: {
          where: {
            status: { in: ACTIVE_DELIVERY_STATUSES },
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

    if (riders.length === 0) {
      console.info("No verified, available riders found.");
      return [];
    }

    const processedRiders = riders
      .filter((rider) => {
        if (previouslyNotifiedRiderIds.has(rider.id)) {
          return false;
        }

        if (
          !rider.userId ||
          !rider.user ||
          !isValidCoordinate(
            rider.currentLatitude,
            rider.currentLongitude
          )
        ) {
          return false;
        }

        return true;
      })
      .map((rider) => {
        const distanceFromPickup = calculateHaversine(
          pickupLatitude,
          pickupLongitude,
          rider.currentLatitude,
          rider.currentLongitude
        );

        return {
          ...rider,
          distanceFromPickup,
          hasActiveDelivery: rider.deliveries.length > 0,
        };
      })
      .filter((rider) => {
        if (rider.distanceFromPickup === null) {
          return false;
        }

        // Riders with active deliveries have a tighter eligibility radius.
        // This checks pickup proximity, not whether they are actually
        // travelling along the existing delivery route.
        if (rider.hasActiveDelivery) {
          return (
            rider.distanceFromPickup <= MAX_BUSY_RIDER_DISTANCE_KM
          );
        }

        return (
          rider.distanceFromPickup <= MAX_IDLE_RIDER_DISTANCE_KM
        );
      })
      .sort((a, b) => a.distanceFromPickup - b.distanceFromPickup);

    const closestRiders = processedRiders.slice(
      0,
      MAX_RIDERS_TO_NOTIFY
    );

    if (closestRiders.length === 0) {
      console.info(
        `No eligible riders within range for delivery ${delivery.id}.`
      );
      return [];
    }

    const expiresAt = new Date(
      Date.now() + REQUEST_EXPIRY_MINUTES * 60 * 1000
    );

    // Create requests before sending notifications.
    await prisma.deliveryRequest.createMany({
      data: closestRiders.map((rider) => ({
        deliveryId: delivery.id,
        riderId: rider.id,
        status: "PENDING",
        distanceFromPickup: rider.distanceFromPickup,
        expiresAt,
      })),
    });

    // One failed notification should not prevent other riders
    // from receiving their requests.
    const notificationResults = await Promise.allSettled(
      closestRiders.map((rider) =>
        sendNotification({
          userId: rider.user.id,
          title: "New Delivery Available 📦",
          message: rider.hasActiveDelivery
            ? `A new delivery is available ${rider.distanceFromPickup.toFixed(1)} km from your current location. Accept only if you can handle it alongside your existing delivery.`
            : `Package ${delivery.trackingId} is available ${rider.distanceFromPickup.toFixed(1)} km away. Open Swiftbox to view and accept the request.`,
          type: "DELIVERY",
        })
      )
    );

    const failedNotifications = notificationResults.filter(
      (result) => result.status === "rejected"
    );

    if (failedNotifications.length > 0) {
      console.error(
        `${failedNotifications.length} rider notification(s) failed for delivery ${delivery.id}.`
      );
    }

    console.info(
      `Delivery ${delivery.id}: created ${closestRiders.length} rider request(s).`
    );

    return closestRiders;
  } catch (error) {
    console.error(
      "Error in dispatchDeliveryToNearbyRiders:",
      error
    );

    return [];
  }
};
