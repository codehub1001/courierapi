import prisma from "../prismaClient.js";


// GET /api/deliveries/track/:trackingId
export const trackPackage = async (req, res) => {
  try {
    const { trackingId } = req.params;

    // =====================================================
    // 1. VALIDATE TRACKING ID
    // =====================================================
    if (!trackingId || !trackingId.trim()) {
      return res.status(400).json({
        message: "Tracking ID is required.",
      });
    }

    // =====================================================
    // 2. FIND DELIVERY WITH RIDER LIVE LOCATION
    // =====================================================
    const delivery = await prisma.delivery.findUnique({
      where: {
        trackingId: trackingId.trim(),
      },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            businessType: true,
            businessAddress: true,
            user: {
              select: {
                fullName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
        rider: {
          select: {
            id: true,
            vehicleNumber: true,
            deliveryArea: true,
            isVerified: true,
            isAvailable: true,
            currentLatitude: true,
            currentLongitude: true,
            user: {
              select: {
                id: true,
                fullName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!delivery) {
      return res.status(404).json({
        message:
          "No package found with that tracking ID. Please verify the code.",
      });
    }

    // =====================================================
    // 3. HAVERSINE DISTANCE MATH HELPER
    // =====================================================
    const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
      if (lat1 == null || lon1 == null || lat2 == null || lon2 == null) return null;
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLon = ((lon2 - lon1) * Math.PI) / 180;

      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);

      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return Number((R * c).toFixed(2));
    };

    // =====================================================
    // 4. CALCULATE DYNAMIC DISTANCE REMAINING & ETA
    // =====================================================
    let distanceRemainingKm = null;
    let targetCoords = null;

    if (delivery.status === "DELIVERED") {
      distanceRemainingKm = 0;
    } else if (delivery.rider && delivery.rider.currentLatitude && delivery.rider.currentLongitude) {
      if (delivery.status === "ASSIGNED") {
        targetCoords = {
          latitude: delivery.pickupLatitude,
          longitude: delivery.pickupLongitude,
        };
      } else if (delivery.status === "PICKED_UP" || delivery.status === "IN_TRANSIT") {
        targetCoords = {
          latitude: delivery.recipientLatitude,
          longitude: delivery.recipientLongitude,
        };
      }

      if (targetCoords) {
        distanceRemainingKm = calculateDistanceKm(
          delivery.rider.currentLatitude,
          delivery.rider.currentLongitude,
          targetCoords.latitude,
          targetCoords.longitude
        );
      }
    }

    // Ensure fallback live calculation if etaMinutes is missing in DB but distance is available
    let computedEtaMinutes = delivery.etaMinutes;
    if (!computedEtaMinutes && distanceRemainingKm !== null) {
      computedEtaMinutes = Math.max(1, Math.ceil((distanceRemainingKm * 1000) / 416));
    }

    // =====================================================
    // 5. DETERMINE CURRENT PROGRESS STEP
    // =====================================================
    const statusStepMap = {
      PENDING: 1,
      ASSIGNED: 2,
      PICKED_UP: 3,
      IN_TRANSIT: 3,
      DELIVERED: 4,
      CANCELLED: 1,
    };

    const currentStep = statusStepMap[delivery.status] || 1;

    // =====================================================
    // 6. FORMAT DATA PAYLOADS
    // =====================================================
    const rider = delivery.rider
      ? {
          id: delivery.rider.id,
          name: delivery.rider.user?.fullName || "Courier Rider",
          phone: delivery.rider.user?.phone || null,
          email: delivery.rider.user?.email || null,
          vehicle: "Delivery Bike",
          plateNumber: delivery.rider.vehicleNumber || null,
          deliveryArea: delivery.rider.deliveryArea || null,
          isVerified: delivery.rider.isVerified,
          isAvailable: delivery.rider.isAvailable,
          currentLocation: {
            latitude: delivery.rider.currentLatitude,
            longitude: delivery.rider.currentLongitude,
          },
        }
      : null;

    const sender = {
      name:
        delivery.vendor?.businessName ||
        delivery.vendor?.user?.fullName ||
        "Vendor",
      phone: delivery.vendor?.user?.phone || null,
      address: delivery.vendor?.businessAddress || "Address unavailable",
      location: {
        latitude: delivery.pickupLatitude,
        longitude: delivery.pickupLongitude,
      },
    };

    const recipient = {
      name: delivery.recipientName || "Recipient",
      phone: delivery.recipientPhone || null,
      address: delivery.recipientAddress || "Address unavailable",
      location: {
        latitude: delivery.recipientLatitude,
        longitude: delivery.recipientLongitude,
      },
    };

    // =====================================================
    // 7. DELIVERY STEPS & ACTIVITY LOGS
    // =====================================================
    const steps = [
      {
        step: 1,
        label: "Order Created",
        time: delivery.createdAt
          ? new Date(delivery.createdAt).toLocaleString()
          : "Completed",
      },
      {
        step: 2,
        label: "Rider Assigned",
        time: delivery.riderId ? "Rider assigned" : "Waiting for rider",
      },
      {
        step: 3,
        label: "In Transit",
        time:
          delivery.status === "IN_TRANSIT"
            ? "In progress"
            : delivery.status === "PICKED_UP"
            ? "Package picked up"
            : "Pending",
      },
      {
        step: 4,
        label: "Delivered",
        time: delivery.status === "DELIVERED" ? "Delivered" : "Pending",
      },
    ];

    const activityLogs = [];

    activityLogs.push({
      message: "Delivery created",
      status: "PENDING",
      timestamp: new Date(delivery.createdAt).toLocaleString(),
    });

    if (delivery.riderId) {
      activityLogs.unshift({
        message: "A rider has been assigned to your delivery",
        status: "ASSIGNED",
        timestamp: new Date(delivery.updatedAt).toLocaleString(),
      });
    }

    if (delivery.arrivedAtPickupAt) {
      activityLogs.unshift({
        message: "Rider arrived at pickup location",
        status: "ARRIVED_AT_PICKUP",
        timestamp: new Date(delivery.arrivedAtPickupAt).toLocaleString(),
      });
    }

    if (delivery.status === "PICKED_UP" || delivery.status === "IN_TRANSIT") {
      activityLogs.unshift({
        message: "Your package has been picked up",
        status: "PICKED_UP",
        timestamp: new Date(delivery.updatedAt).toLocaleString(),
      });
    }

    if (delivery.status === "IN_TRANSIT") {
      activityLogs.unshift({
        message: "Your package is currently in transit",
        status: "IN_TRANSIT",
        timestamp: new Date(delivery.updatedAt).toLocaleString(),
      });
    }

    if (delivery.arrivedAtDropoffAt) {
      activityLogs.unshift({
        message: "Rider arrived at destination",
        status: "ARRIVED_AT_DROPOFF",
        timestamp: new Date(delivery.arrivedAtDropoffAt).toLocaleString(),
      });
    }

    if (delivery.status === "DELIVERED") {
      activityLogs.unshift({
        message: "Your package has been delivered successfully",
        status: "DELIVERED",
        timestamp: new Date(delivery.updatedAt).toLocaleString(),
      });
    }

    if (delivery.status === "CANCELLED") {
      activityLogs.unshift({
        message: "This delivery has been cancelled",
        status: "CANCELLED",
        timestamp: new Date(delivery.updatedAt).toLocaleString(),
      });
    }

    // =====================================================
    // 8. RESPONSE PAYLOAD
    // =====================================================
    return res.status(200).json({
      success: true,
      delivery: {
        id: delivery.id,
        trackingId: delivery.trackingId,
        status: delivery.status,
        currentStep,

        sender,
        vendor: {
          id: delivery.vendor?.id || null,
          businessName: delivery.vendor?.businessName || null,
          businessType: delivery.vendor?.businessType || null,
          businessAddress: delivery.vendor?.businessAddress || null,
        },
        recipient,

        packageDetails: {
          type: delivery.packageType || "Standard Package",
          weight: delivery.packageWeight || "Not specified",
          instructions: delivery.deliveryInstructions || null,
        },

        rider,
        activityLogs,
        steps,

        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,

        // 📍 LIVE ESTIMATES & DISTANCE METRICS
        etaMinutes: computedEtaMinutes || null,
        estimatedArrival:
          delivery.status === "DELIVERED"
            ? "Delivered"
            : computedEtaMinutes
            ? `${computedEtaMinutes} mins`
            : delivery.status === "IN_TRANSIT" || delivery.status === "ASSIGNED"
            ? "Calculating..."
            : "Pending",

        distanceRemaining:
          distanceRemainingKm !== null ? `${distanceRemainingKm} km` : "Calculating...",
        distanceRemainingKm,
      },
    });
  } catch (error) {
    console.error("Error tracking package:", error);

    return res.status(500).json({
      message: "Server error occurred while fetching tracking info.",
    });
  }
};