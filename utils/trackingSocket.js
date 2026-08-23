import prisma from "../prismaClient.js";



// Haversine distance helper (returns distance in meters)
const getDistanceInMeters = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth radius in meters
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) *
      Math.cos(lat2 * rad) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const registerTrackingSocketHandlers = (io, socket) => {
  // =====================================================
  // 1. CLIENT ROOM SUBSCRIPTION
  // =====================================================
  socket.on("JOIN_DELIVERY_ROOM", ({ deliveryId }) => {
    if (!deliveryId) return;
    const roomName = `delivery_${deliveryId}`;
    socket.join(roomName);
    console.log(`📡 Socket ${socket.id} joined tracking room: ${roomName}`);
  });

  socket.on("LEAVE_DELIVERY_ROOM", ({ deliveryId }) => {
    if (!deliveryId) return;
    const roomName = `delivery_${deliveryId}`;
    socket.leave(roomName);
    console.log(`🔌 Socket ${socket.id} left room: ${roomName}`);
  });

  // =====================================================
  // 2. RIDER LIVE LOCATION PING
  // =====================================================
  socket.on("RIDER_LOCATION_UPDATE", async (data) => {
    try {
      const { riderId, latitude, longitude } = data;

      if (!riderId || latitude == null || longitude == null) return;

      // Update rider's location in DB
      await prisma.riderProfile.update({
        where: { id: riderId },
        data: {
          currentLatitude: latitude,
          currentLongitude: longitude,
          lastLocationUpdate: new Date(),
        },
      });

      // Fetch active delivery for rider using string literals
      const activeDelivery = await prisma.delivery.findFirst({
        where: {
          riderId,
          status: {
            in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"],
          },
        },
      });

      if (!activeDelivery) return;

      const roomName = `delivery_${activeDelivery.id}`;
      const isEnRouteToPickup = activeDelivery.status === "ASSIGNED";

      const targetLat = isEnRouteToPickup
        ? activeDelivery.pickupLatitude
        : activeDelivery.recipientLatitude;
      const targetLng = isEnRouteToPickup
        ? activeDelivery.pickupLongitude
        : activeDelivery.recipientLongitude;

      let distanceToTargetMeters = null;

      if (targetLat != null && targetLng != null) {
        distanceToTargetMeters = getDistanceInMeters(
          latitude,
          longitude,
          targetLat,
          targetLng
        );

        const estimatedMinutes = Math.max(
          1,
          Math.ceil(distanceToTargetMeters / 416)
        );

        await prisma.delivery.update({
          where: { id: activeDelivery.id },
          data: {
            etaMinutes: estimatedMinutes,
            estimatedDeliveryTime: new Date(
              Date.now() + estimatedMinutes * 60 * 1000
            ),
          },
        });

        // Geofence trigger check (150 meters)
        if (distanceToTargetMeters <= 150) {
          if (isEnRouteToPickup && !activeDelivery.arrivedAtPickupAt) {
            await prisma.delivery.update({
              where: { id: activeDelivery.id },
              data: { arrivedAtPickupAt: new Date() },
            });

            io.to(roomName).emit("GEOFENCE_TRIGGERED", {
              deliveryId: activeDelivery.id,
              event: "RIDER_ARRIVED_AT_PICKUP",
              message: "Your rider has arrived at the pickup location!",
              timestamp: new Date(),
            });
          } else if (!isEnRouteToPickup && !activeDelivery.arrivedAtDropoffAt) {
            await prisma.delivery.update({
              where: { id: activeDelivery.id },
              data: { arrivedAtDropoffAt: new Date() },
            });

            io.to(roomName).emit("GEOFENCE_TRIGGERED", {
              deliveryId: activeDelivery.id,
              event: "RIDER_ARRIVED_AT_DROPOFF",
              message: "Your rider is outside with your package!",
              timestamp: new Date(),
            });
          }
        }
      }

      // Stream position to tracking room
      io.to(roomName).emit("LOCATION_STREAM", {
        deliveryId: activeDelivery.id,
        riderId,
        latitude,
        longitude,
        distanceRemainingKm: distanceToTargetMeters
          ? Number((distanceToTargetMeters / 1000).toFixed(2))
          : null,
        etaMinutes: activeDelivery.etaMinutes,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error("❌ Socket location update error:", error);
    }
  });
};