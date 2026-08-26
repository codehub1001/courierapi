import prisma from "../prismaClient.js";
import { processDeliveryGeofences } from "../service/geofenceService.js";

// ─────────────────────────────────────────────
// 1. GET RIDER PROFILE & STATS
// ─────────────────────────────────────────────


// ─────────────────────────────────────────────
// 1. GET RIDER PROFILE & STATS
// ─────────────────────────────────────────────
export const getRiderProfile = async (req, res) => {
  try {
    const rider = await prisma.riderProfile.findUnique({
      where: { userId: req.user.id },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            wallet: true,
          },
        },
      },
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found",
      });
    }

    // --- DEBUG LOG: Check what is actually being sent to the frontend ---
    console.log("SENDING RIDER TO FRONTEND -> isVerified:", rider.isVerified);

    // Fetch completed deliveries count dynamically
    const completedDeliveries = await prisma.delivery.count({
      where: { riderId: rider.id, status: "DELIVERED" },
    });

    return res.status(200).json({
      success: true,
      rider: {
        ...rider,
        completedDeliveries,
      },
    });
  } catch (error) {
    console.error("Get rider profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch rider profile",
    });
  }
};
// ─────────────────────────────────────────────
// 2. TOGGLE AVAILABILITY (ONLINE / OFFLINE)
// ─────────────────────────────────────────────
export const toggleAvailability = async (req, res) => {
  try {
    const { isAvailable } = req.body;

    const rider = await prisma.riderProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found",
      });
    }

    // Prevent going offline if they currently have an active delivery
    if (!isAvailable) {
      const activeDelivery = await prisma.delivery.findFirst({
        where: {
          riderId: rider.id,
          status: { in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"] },
        },
      });

      if (activeDelivery) {
        return res.status(400).json({
          success: false,
          message: "Cannot go offline while you have an active delivery",
        });
      }
    }

    const updatedRider = await prisma.riderProfile.update({
      where: { id: rider.id },
      data: { isAvailable },
    });

    return res.status(200).json({
      success: true,
      message: `You are now ${isAvailable ? "ONLINE" : "OFFLINE"}`,
      isAvailable: updatedRider.isAvailable,
    });
  } catch (error) {
    console.error("Toggle availability error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update availability status",
    });
  }
};

// ─────────────────────────────────────────────
// 3. UPDATE LIVE LOCATION
// ─────────────────────────────────────────────
export const updateLocation = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication error: User ID missing from token.",
      });
    }

    const { latitude, longitude } = req.body;

    // ─────────────────────────────────────────────
    // VALIDATE REQUIRED FIELDS
    // ─────────────────────────────────────────────

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required.",
      });
    }

    const parsedLatitude = Number(latitude);
    const parsedLongitude = Number(longitude);

    // ─────────────────────────────────────────────
    // VALIDATE COORDINATES
    // ─────────────────────────────────────────────

    if (
      !Number.isFinite(parsedLatitude) ||
      !Number.isFinite(parsedLongitude)
    ) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude must be valid numbers.",
      });
    }

    if (parsedLatitude < -90 || parsedLatitude > 90) {
      return res.status(400).json({
        success: false,
        message: "Latitude must be between -90 and 90.",
      });
    }

    if (parsedLongitude < -180 || parsedLongitude > 180) {
      return res.status(400).json({
        success: false,
        message: "Longitude must be between -180 and 180.",
      });
    }

    // ─────────────────────────────────────────────
    // FIND RIDER
    // ─────────────────────────────────────────────

    const rider = await prisma.riderProfile.findUnique({
      where: {
        userId,
      },
      select: {
        id: true,
        isVerified: true,
        currentLatitude: true,
        currentLongitude: true,
        lastLocationUpdate: true,
      },
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found.",
      });
    }

    // ─────────────────────────────────────────────
    // UPDATE RIDER LOCATION
    // ─────────────────────────────────────────────

    const updatedRider = await prisma.riderProfile.update({
      where: {
        userId,
      },
      data: {
        currentLatitude: parsedLatitude,
        currentLongitude: parsedLongitude,
        lastLocationUpdate: new Date(),
      },
      select: {
        currentLatitude: true,
        currentLongitude: true,
        lastLocationUpdate: true,
      },
    });

    // ─────────────────────────────────────────────
    // TRIGGER GEOFENCE EVALUATION (NON-BLOCKING)
    // ─────────────────────────────────────────────
    processDeliveryGeofences(rider.id, parsedLatitude, parsedLongitude).catch((err) => {
      console.error("Geofence execution failed in background:", err);
    });

    return res.status(200).json({
      success: true,
      message: "Rider location updated successfully.",
      location: {
        latitude: updatedRider.currentLatitude,
        longitude: updatedRider.currentLongitude,
        lat: updatedRider.currentLatitude,
        lng: updatedRider.currentLongitude,
        lastUpdated: updatedRider.lastLocationUpdate,
      },
    });
  } catch (error) {
    console.error("Update location error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update rider location.",
    });
  }
};

// ─────────────────────────────────────────────
// 4. GET PENDING DELIVERY REQUESTS
// ─────────────────────────────────────────────


export const getPendingRequests = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication error: User ID missing from token.",
      });
    }

    // =====================================================
    // 1. FIND RIDER
    // =====================================================

    const rider = await prisma.riderProfile.findUnique({
      where: {
        userId,
      },
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found.",
      });
    }

    // =====================================================
    // 2. CHECK RIDER VERIFICATION
    // =====================================================

    if (!rider.isVerified) {
      return res.status(403).json({
        success: false,
        message: "Your rider account has not been verified yet.",
      });
    }

    // =====================================================
    // 3. FIND ACTIVE DELIVERY
    // =====================================================

    const activeDelivery = await prisma.delivery.findFirst({
      where: {
        riderId: rider.id,
        status: {
          in: [
            "ASSIGNED",
            "PICKED_UP",
            "IN_TRANSIT",
          ],
        },
      },
      include: {
        vendor: true,
      },
    });

    // =====================================================
    // 4. GET PENDING REQUESTS
    // =====================================================

    const pendingRequests = await prisma.deliveryRequest.findMany({
      where: {
        riderId: rider.id,

        status: "PENDING",

        delivery: {
          status: "PENDING",
        },

        OR: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              gt: new Date(),
            },
          },
        ],
      },

      include: {
        delivery: {
          include: {
            vendor: {
              select: {
                businessName: true,
                businessAddress: true,
                latitude: true,
                longitude: true,
              },
            },
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    // =====================================================
    // 5. RETURN RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      rider: {
        id: rider.id,
        isVerified: rider.isVerified,
        isAvailable: rider.isAvailable,
      },

      hasActiveDelivery: Boolean(activeDelivery),

      activeDelivery: activeDelivery
        ? {
            id: activeDelivery.id,
            trackingId: activeDelivery.trackingId,
            status: activeDelivery.status,
          }
        : null,

      count: pendingRequests.length,

      requests: pendingRequests,
    });
  } catch (error) {
    console.error("Get pending requests error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending delivery requests.",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// 5. ACCEPT DELIVERY REQUEST (ATOMIC TRANSACTION)
// ─────────────────────────────────────────────
export const acceptDeliveryRequest = async (req, res) => {
  try {
    // Accept requestId from body safely
    const requestId =
      req.body?.requestId ||
      req.params?.requestId ||
      req.params?.id;

    const userId = req.user.id;

    console.log("📦 ACCEPT DELIVERY REQUEST:", {
      requestId,
      body: req.body,
      params: req.params,
      userId,
    });

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Delivery request ID is required",
      });
    }

    // =====================================================
    // 1. FIND RIDER PROFILE
    // =====================================================

    const rider = await prisma.riderProfile.findUnique({
      where: {
        userId,
      },
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found",
      });
    }

    // =====================================================
    // 2. FIND DELIVERY REQUEST
    // =====================================================

    const deliveryRequest =
      await prisma.deliveryRequest.findUnique({
        where: {
          id: requestId,
        },
        include: {
          delivery: true,
        },
      });

    if (!deliveryRequest) {
      return res.status(404).json({
        success: false,
        message: "Delivery request not found",
      });
    }

    // =====================================================
    // 3. VERIFY REQUEST BELONGS TO THIS RIDER
    // =====================================================

    if (deliveryRequest.riderId !== rider.id) {
      return res.status(403).json({
        success: false,
        message:
          "You are not authorized to respond to this request",
      });
    }

    // =====================================================
    // 4. VERIFY REQUEST IS STILL PENDING
    // =====================================================

    if (deliveryRequest.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message:
          "This request is no longer pending",
      });
    }

    // =====================================================
    // 5. CHECK IF DELIVERY IS ALREADY ASSIGNED
    // =====================================================

    if (deliveryRequest.delivery.riderId) {
      return res.status(400).json({
        success: false,
        message:
          "This delivery has already been accepted by another rider",
      });
    }

    // =====================================================
    // 6. ATOMIC ACCEPTANCE & VENDOR NOTIFICATION
    // =====================================================

    const result = await prisma.$transaction(
      async (tx) => {
        // Re-check inside transaction to reduce race conditions
        const latestRequest =
          await tx.deliveryRequest.findUnique({
            where: {
              id: requestId,
            },
            include: {
              delivery: true,
            },
          });

        if (!latestRequest) {
          throw new Error(
            "Delivery request no longer exists"
          );
        }

        if (
          latestRequest.status !== "PENDING"
        ) {
          throw new Error(
            "This delivery request has already been handled"
          );
        }

        if (
          latestRequest.delivery.riderId
        ) {
          throw new Error(
            "This delivery has already been accepted by another rider"
          );
        }

        // Mark request as accepted
        const updatedRequest =
          await tx.deliveryRequest.update({
            where: {
              id: requestId,
            },
            data: {
              status: "ACCEPTED",
              respondedAt: new Date(),
            },
          });

        // Assign rider to delivery & stamp assignedAt
        const updatedDelivery =
          await tx.delivery.update({
            where: {
              id: latestRequest.deliveryId,
            },
            data: {
              riderId: rider.id,
              status: "ASSIGNED",
              assignedAt: new Date(), // 👈 THIS STARTS THE 15-MINUTE STALE CLOCK
            },
          });

        // Reject all other rider requests
        await tx.deliveryRequest.updateMany({
          where: {
            deliveryId:
              latestRequest.deliveryId,

            id: {
              not: requestId,
            },

            status: "PENDING",
          },

          data: {
            status: "REJECTED",
            respondedAt: new Date(),
          },
        });

        // Find vendor to notify
        const vendor =
          await tx.vendorProfile.findUnique({
            where: {
              id: latestRequest.delivery.vendorId,
            },
          });

        // Notify vendor that rider accepted & payment is required
        if (vendor) {
          await tx.notification.create({
            data: {
              userId: vendor.userId,
              deliveryId: latestRequest.deliveryId,
              title: "Rider Assigned! 🚴‍♂️",
              message: `A rider has accepted your delivery (${latestRequest.delivery.trackingId}). Please complete payment so they can proceed.`,
              type: "PAYMENT_REQUIRED",
            },
          });
        }

        return {
          updatedRequest,
          updatedDelivery,
        };
      }
    );

    // =====================================================
    // 7. SUCCESS RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,
      message:
        "Delivery request accepted. Waiting for vendor payment.",
      delivery: result.updatedDelivery,
      request: result.updatedRequest,
    });
  } catch (error) {
    console.error(
      "❌ ACCEPT DELIVERY REQUEST ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        error.message ||
        "Failed to accept delivery request",
    });
  }
};

// ─────────────────────────────────────────────
// 6. REJECT DELIVERY REQUEST
// ─────────────────────────────────────────────
export const rejectDeliveryRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    const rider = await prisma.riderProfile.findUnique({
      where: { userId: req.user.id },
    });

    const request = await prisma.deliveryRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.riderId !== rider?.id) {
      return res.status(404).json({
        success: false,
        message: "Delivery request not found or unauthorized",
      });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Request has already been responded to or expired",
      });
    }

    await prisma.deliveryRequest.update({
      where: { id: requestId },
      data: {
        status: "REJECTED",
        respondedAt: new Date(),
      },
    });

    return res.status(200).json({
      success: true,
      message: "Delivery request rejected",
    });
  } catch (error) {
    console.error("Reject delivery request error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reject delivery request",
    });
  }
};

// ─────────────────────────────────────────────
// 7. GET CURRENT ACTIVE DELIVERY
// ─────────────────────────────────────────────
export const getActiveDelivery = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication error: User ID missing from token.",
      });
    }

    const rider = await prisma.riderProfile.findUnique({
      where: { userId },
      select: { id: true, userId: true },
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found.",
      });
    }

    const activeDelivery = await prisma.delivery.findFirst({
      where: {
        riderId: rider.id,
        status: {
          in: ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"],
        },
      },
      include: {
        vendor: {
          select: {
            businessName: true,
            businessAddress: true,
            latitude: true,
            longitude: true,
            user: {
              select: { phone: true },
            },
          },
        },
        payments: {
          select: {
            status: true,
            amount: true,
            reference: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // ✅ FIXED: Check if ANY payment record is SUCCESS, fallback to the latest if needed
    const successfulPayment = activeDelivery?.payments?.find(p => p.status === "SUCCESS");
    const payment = successfulPayment || activeDelivery?.payments?.[0];
    const isPaid = !!successfulPayment;

    // If payment is not completed, redact full pickup details to ensure UX safety
    let sanitizedDelivery = activeDelivery;
    if (activeDelivery && !isPaid) {
      sanitizedDelivery = {
        ...activeDelivery,
        vendor: {
          businessName: "Payment Pending (Hidden)",
          businessAddress: "Exact address unlocks after payment verification.",
          latitude: null,
          longitude: null,
          user: { phone: null },
        },
        recipientName: "Restricted",
        recipientAddress: "Restricted until payment is confirmed",
        recipientPhone: null,
        deliveryInstructions: "Please wait for payment confirmation before heading to pickup.",
      };
    }

    return res.status(200).json({
      success: true,
      isPaid,
      delivery: sanitizedDelivery,
    });
  } catch (error) {
    console.error("Get active delivery error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch active delivery.",
    });
  }
};

// ─────────────────────────────────────────────
// 8. UPDATE DELIVERY STATUS (STATE MACHINE)
// ─────────────────────────────────────────────
export const updateDeliveryStatus = async (req, res) => {
  try {
    const { deliveryId } = req.params;
    const { status, verificationCode } = req.body || {};

    console.log("📦 UPDATE DELIVERY STATUS REQUEST");
    console.log({
      deliveryId,
      status,
      verificationCode,
      userId: req.user?.id,
    });

    // =====================================================
    // 1. VALIDATE REQUEST BODY
    // =====================================================

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Delivery status is required",
      });
    }

    const validTransitions = [
      "PICKED_UP",
      "IN_TRANSIT",
      "DELIVERED",
    ];

    if (!validTransitions.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status transition. Received: ${status}`,
      });
    }

    // =====================================================
    // 2. FIND RIDER
    // =====================================================

    const rider = await prisma.riderProfile.findUnique({
      where: {
        userId: req.user.id,
      },
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found",
      });
    }

    // =====================================================
    // 3. FIND DELIVERY
    // =====================================================

    const delivery = await prisma.delivery.findUnique({
      where: {
        id: deliveryId,
      },
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // =====================================================
    // 4. VERIFY RIDER OWNERSHIP
    // =====================================================

    if (delivery.riderId !== rider.id) {
      return res.status(403).json({
        success: false,
        message: "This delivery is not assigned to you",
      });
    }

    // =====================================================
    // 5. PAYMENT MUST BE SUCCESSFUL BEFORE PICKUP
    // =====================================================

    const payment = await prisma.payment.findFirst({
      where: {
        deliveryId: delivery.id,
        status: "SUCCESS",
      },
    });

    if (
      status === "PICKED_UP" &&
      !payment
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Payment must be completed before the package can be picked up",
      });
    }

    // =====================================================
    // 6. VALIDATE STATUS FLOW
    // =====================================================

    if (
      status === "PICKED_UP" &&
      delivery.status !== "ASSIGNED"
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Package must be ASSIGNED before pickup. Current status: ${delivery.status}`,
      });
    }

    if (
      status === "IN_TRANSIT" &&
      delivery.status !== "PICKED_UP"
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Package must be PICKED_UP first. Current status: ${delivery.status}`,
      });
    }

    if (
      status === "DELIVERED" &&
      delivery.status !== "IN_TRANSIT"
    ) {
      return res.status(400).json({
        success: false,
        message:
          `Package must be IN_TRANSIT before delivery. Current status: ${delivery.status}`,
      });
    }

    // =====================================================
    // 7. COMPLETE DELIVERY
    // =====================================================

    if (status === "DELIVERED") {
      // -----------------------------------------------
      // VERIFY DELIVERY PIN
      // -----------------------------------------------

      if (delivery.deliveryPin) {
        if (
          !verificationCode ||
          verificationCode.trim() !==
            delivery.deliveryPin.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              "Invalid delivery verification PIN code",
          });
        }
      }

      const completedDelivery =
        await prisma.$transaction(async (tx) => {
          // -------------------------------------------
          // UPDATE DELIVERY (Clear assignedAt since it's now completed)
          // -------------------------------------------

          const updatedDelivery =
            await tx.delivery.update({
              where: {
                id: deliveryId,
              },
              data: {
                status: "DELIVERED",
                assignedAt: null, 
              },
            });

          // -------------------------------------------
          // RIDER FEE
          // -------------------------------------------

          const riderFee =
            Number(delivery.riderFee || 0);

          // -------------------------------------------
          // FIND OR CREATE WALLET
          // -------------------------------------------

          let wallet =
            await tx.wallet.findUnique({
              where: {
                userId: rider.userId,
              },
            });

          if (!wallet) {
            wallet = await tx.wallet.create({
              data: {
                userId: rider.userId,
                balance: 0,
              },
            });
          }

          // -------------------------------------------
          // CREDIT RIDER WALLET
          // -------------------------------------------

          if (riderFee > 0) {
            await tx.wallet.update({
              where: {
                id: wallet.id,
              },
              data: {
                balance: {
                  increment: riderFee,
                },
              },
            });

            await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                amount: riderFee,
                type: "CREDIT",
                status: "COMPLETED",
                referenceId: delivery.id,
                description:
                  `Earnings for completed delivery #${delivery.trackingId}`,
              },
            });
          }

          // -------------------------------------------
          // UPDATE RIDER STATS
          // -------------------------------------------

          await tx.riderProfile.update({
            where: {
              id: rider.id,
            },
            data: {
              totalDeliveries: {
                increment: 1,
              },
              isAvailable: true,
            },
          });

          // -------------------------------------------
          // NOTIFY RIDER
          // -------------------------------------------

          await tx.notification.create({
            data: {
              userId: rider.userId,
              title: "Delivery Completed & Paid",
              message: `Delivery #${delivery.trackingId} was successfully completed. ₦${riderFee.toLocaleString(
                "en-NG"
              )} has been added to your wallet.`,
              type: "WALLET",
            },
          });

          // -------------------------------------------
          // NOTIFY VENDOR
          // -------------------------------------------

          const vendor =
            await tx.vendorProfile.findUnique({
              where: {
                id: delivery.vendorId,
              },
            });

          if (vendor) {
            await tx.notification.create({
              data: {
                userId: vendor.userId,
                title: "Delivery Completed",
                message: `Your delivery #${delivery.trackingId} has been successfully delivered.`,
                type: "DELIVERY_COMPLETED",
              },
            });
          }

          return updatedDelivery;
        });

      return res.status(200).json({
        success: true,
        message:
          "Delivery completed successfully",
        delivery: completedDelivery,
      });
    }

    // =====================================================
    // 8. UPDATE PICKED_UP / IN_TRANSIT
    // =====================================================

    const updatedDelivery =
      await prisma.delivery.update({
        where: {
          id: deliveryId,
        },
        data: {
          status,
          // Clear assignedAt once the package is picked up so it leaves the stale queue
          ...(status === "PICKED_UP" ? { assignedAt: null } : {}),
        },
      });

    return res.status(200).json({
      success: true,
      message:
        `Delivery status updated to ${status}`,
      delivery: updatedDelivery,
    });
  } catch (error) {
    console.error(
      "❌ UPDATE DELIVERY STATUS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update delivery status",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};

// ─────────────────────────────────────────────
// 9. GET DELIVERY HISTORY & EARNINGS
// ─────────────────────────────────────────────
export const getDeliveryHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const rider = await prisma.riderProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }

    const whereClause = {
      riderId: rider.id,
      ...(status ? { status } : { status: { in: ["DELIVERED", "CANCELLED"] } }),
    };

    const [history, totalCount] = await Promise.all([
      prisma.delivery.findMany({
        where: whereClause,
        skip,
        take: parseInt(limit),
        orderBy: { updatedAt: "desc" },
      }),
      prisma.delivery.count({ where: whereClause }),
    ]);

    return res.status(200).json({
      success: true,
      pagination: {
        total: totalCount,
        page: parseInt(page),
        pages: Math.ceil(totalCount / parseInt(limit)),
      },
      deliveries: history,
    });
  } catch (error) {
    console.error("Get delivery history error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch delivery history",
    });
  }
};
// ─────────────────────────────────────────────
// UPDATE RIDER PROFILE & BANK PAYOUT DETAILS
// ─────────────────────────────────────────────
export const updateRiderProfile = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication error: User ID missing from token.",
      });
    }

    const {
      fullName,
      phone,
      vehicleNumber,
      deliveryArea,
      licenseNumber,
      bankName,
      accountNumber,
      accountName,
    } = req.body || {};

    // 1. Find existing rider profile
    const rider = await prisma.riderProfile.findUnique({
      where: { userId },
    });

    if (!rider) {
      return res.status(404).json({
        success: false,
        message: "Rider profile not found.",
      });
    }

    // 2. Update core user details if provided
    if (fullName || phone) {
      await prisma.user.update({
        where: { id: userId },
        data: {
          ...(fullName && { fullName }),
          ...(phone && { phone }),
        },
      });
    }

    // 3. Update rider profile fields including bank payout details
    const updatedRider = await prisma.riderProfile.update({
      where: { userId },
      data: {
        ...(vehicleNumber !== undefined && { vehicleNumber }),
        ...(deliveryArea !== undefined && { deliveryArea }),
        ...(licenseNumber !== undefined && { licenseNumber }),
        ...(bankName !== undefined && { bankName }),
        ...(accountNumber !== undefined && { accountNumber }),
        ...(accountName !== undefined && { accountName }),
      },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            wallet: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "Profile and payout details updated successfully.",
      rider: updatedRider,
    });
  } catch (error) {
    console.error("Update rider profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update rider profile.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};