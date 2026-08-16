import prisma from "../prismaClient.js";


// GET /api/deliveries/track/:trackingId
export const trackPackage = async (req, res) => {
  try {
    const { trackingId } = req.params;

    // ─────────────────────────────────────
    // VALIDATE TRACKING ID
    // ─────────────────────────────────────

    if (!trackingId || !trackingId.trim()) {
      return res.status(400).json({
        message: "Tracking ID is required.",
      });
    }

    // ─────────────────────────────────────
    // FIND DELIVERY
    // ─────────────────────────────────────

    const delivery = await prisma.delivery.findUnique({
      where: {
        trackingId: trackingId.trim(),
      },

      include: {
        // ─────────────────────────────────
        // VENDOR INFORMATION
        // ─────────────────────────────────

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

        // ─────────────────────────────────
        // RIDER INFORMATION
        // ─────────────────────────────────

        rider: {
          select: {
            id: true,
            vehicleNumber: true,
            deliveryArea: true,
            isVerified: true,
            isAvailable: true,

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

    // ─────────────────────────────────────
    // DELIVERY NOT FOUND
    // ─────────────────────────────────────

    if (!delivery) {
      return res.status(404).json({
        message:
          "No package found with that tracking ID. Please verify the code.",
      });
    }

    // ─────────────────────────────────────
    // DETERMINE CURRENT PROGRESS STEP
    // ─────────────────────────────────────

    const statusStepMap = {
      PENDING: 1,
      ASSIGNED: 2,
      PICKED_UP: 3,
      IN_TRANSIT: 3,
      DELIVERED: 4,
      CANCELLED: 1,
    };

    const currentStep = statusStepMap[delivery.status] || 1;

    // ─────────────────────────────────────
    // FORMAT RIDER DATA
    // ─────────────────────────────────────

    const rider = delivery.rider
      ? {
          id: delivery.rider.id,

          name:
            delivery.rider.user?.fullName ||
            "Courier Rider",

          phone:
            delivery.rider.user?.phone ||
            null,

          email:
            delivery.rider.user?.email ||
            null,

          vehicle:
            "Delivery Bike",

          plateNumber:
            delivery.rider.vehicleNumber ||
            null,

          deliveryArea:
            delivery.rider.deliveryArea ||
            null,

          isVerified:
            delivery.rider.isVerified,

          isAvailable:
            delivery.rider.isAvailable,
        }
      : null;

    // ─────────────────────────────────────
    // FORMAT VENDOR DATA
    // ─────────────────────────────────────

    const sender = {
      name:
        delivery.vendor?.businessName ||
        delivery.vendor?.user?.fullName ||
        "Vendor",

      phone:
        delivery.vendor?.user?.phone ||
        null,

      address:
        delivery.vendor?.businessAddress ||
        "Address unavailable",
    };

    // ─────────────────────────────────────
    // FORMAT RECIPIENT DATA
    // ─────────────────────────────────────

    const recipient = {
      name:
        delivery.recipientName ||
        "Recipient",

      phone:
        delivery.recipientPhone ||
        null,

      address:
        delivery.recipientAddress ||
        "Address unavailable",
    };

    // ─────────────────────────────────────
    // DELIVERY STEPS
    // ─────────────────────────────────────

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
        time:
          delivery.riderId
            ? "Rider assigned"
            : "Waiting for rider",
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
        time:
          delivery.status === "DELIVERED"
            ? "Delivered"
            : "Pending",
      },
    ];

    // ─────────────────────────────────────
    // ACTIVITY LOGS
    // ─────────────────────────────────────

    const activityLogs = [];

    activityLogs.push({
      message: "Delivery created",
      status: "PENDING",
      timestamp: new Date(
        delivery.createdAt
      ).toLocaleString(),
    });

    if (delivery.riderId) {
      activityLogs.unshift({
        message: "A rider has been assigned to your delivery",
        status: "ASSIGNED",
        timestamp: new Date(
          delivery.updatedAt
        ).toLocaleString(),
      });
    }

    if (
      delivery.status === "PICKED_UP" ||
      delivery.status === "IN_TRANSIT"
    ) {
      activityLogs.unshift({
        message: "Your package has been picked up",
        status: "PICKED_UP",
        timestamp: new Date(
          delivery.updatedAt
        ).toLocaleString(),
      });
    }

    if (delivery.status === "IN_TRANSIT") {
      activityLogs.unshift({
        message: "Your package is currently in transit",
        status: "IN_TRANSIT",
        timestamp: new Date(
          delivery.updatedAt
        ).toLocaleString(),
      });
    }

    if (delivery.status === "DELIVERED") {
      activityLogs.unshift({
        message: "Your package has been delivered successfully",
        status: "DELIVERED",
        timestamp: new Date(
          delivery.updatedAt
        ).toLocaleString(),
      });
    }

    if (delivery.status === "CANCELLED") {
      activityLogs.unshift({
        message: "This delivery has been cancelled",
        status: "CANCELLED",
        timestamp: new Date(
          delivery.updatedAt
        ).toLocaleString(),
      });
    }

    // ─────────────────────────────────────
    // FINAL RESPONSE
    // ─────────────────────────────────────

    return res.status(200).json({
      success: true,

      delivery: {
        id: delivery.id,

        trackingId: delivery.trackingId,

        status: delivery.status,

        currentStep,

        // ─────────────────────────────────
        // SENDER / VENDOR
        // ─────────────────────────────────

        sender,

        vendor: {
          id: delivery.vendor?.id || null,

          businessName:
            delivery.vendor?.businessName ||
            null,

          businessType:
            delivery.vendor?.businessType ||
            null,

          businessAddress:
            delivery.vendor?.businessAddress ||
            null,
        },

        // ─────────────────────────────────
        // RECIPIENT
        // ─────────────────────────────────

        recipient,

        // ─────────────────────────────────
        // PACKAGE
        // ─────────────────────────────────

        packageDetails: {
          type:
            delivery.packageType ||
            "Standard Package",

          weight:
            delivery.packageWeight ||
            "Not specified",

          instructions:
            delivery.deliveryInstructions ||
            null,
        },

        // ─────────────────────────────────
        // RIDER
        // ─────────────────────────────────

        rider,

        // ─────────────────────────────────
        // ACTIVITY
        // ─────────────────────────────────

        activityLogs,

        steps,

        // ─────────────────────────────────
        // TIMESTAMPS
        // ─────────────────────────────────

        createdAt: delivery.createdAt,

        updatedAt: delivery.updatedAt,

        // ─────────────────────────────────
        // ESTIMATED DELIVERY
        // ─────────────────────────────────

        estimatedArrival:
          delivery.status === "DELIVERED"
            ? "Delivered"
            : delivery.status === "IN_TRANSIT"
            ? "On the way"
            : "Calculating...",

        distanceRemaining:
          delivery.status === "DELIVERED"
            ? "0 km"
            : "Calculating...",
      },
    });
  } catch (error) {
    console.error("Error tracking package:", error);

    return res.status(500).json({
      message:
        "Server error occurred while fetching tracking info.",
    });
  }
};