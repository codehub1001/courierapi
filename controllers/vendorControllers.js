import prisma from "../prismaClient.js";
import { geocodeAddress } from "../utils/geocodeAddress.js";
import { sendNotification } from "../utils/sendNotification.js";
import { getRoadRoute } from "../utils/routing.js";
import { calculateDeliveryFee } from "../utils/pricing.js";
import { dispatchDeliveryToNearbyRiders } from "../utils/dispatchHelper.js";

/*
|--------------------------------------------------------------------------
| GET VENDOR PROFILE
|--------------------------------------------------------------------------
| GET /api/vendor/profile
*/
/*
|--------------------------------------------------------------------------
| GET VENDOR PROFILE
|--------------------------------------------------------------------------
| GET /api/vendor/profile
|--------------------------------------------------------------------------
*/
export const getVendorProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const vendor = await prisma.user.findUnique({
      where: {
        id: userId,
      },

      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        phone: true,
        role: true,
        status: true,

        vendorProfile: {
          select: {
            id: true,
            businessName: true,
            businessType: true,
            businessAddress: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });

    if (!vendor) {
      return res.status(404).json({
        message: "Vendor not found",
      });
    }

    if (vendor.role !== "VENDOR") {
      return res.status(403).json({
        message: "Access denied. Vendor account required.",
      });
    }

    return res.status(200).json({
      success: true,
      user: vendor,
      vendorProfile: vendor.vendorProfile,
    });
  } catch (error) {
    console.error("Get vendor profile error:", error);

    return res.status(500).json({
      message: "Failed to fetch vendor profile",
    });
  }
};


/*
|--------------------------------------------------------------------------
| GET VENDOR DASHBOARD OVERVIEW
|--------------------------------------------------------------------------
| GET /api/vendor/overview
*/
export const getVendorOverview = async (req, res) => {
  try {
    const userId = req.user.id;

    const vendor = await prisma.vendorProfile.findUnique({
      where: {
        userId,
      },
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found",
      });
    }

    const [
      totalDeliveries,
      pendingDeliveries,
      activeDeliveries,
      completedDeliveries,
      cancelledDeliveries,
      recentDeliveries,
    ] = await Promise.all([
      prisma.delivery.count({
        where: {
          vendorId: vendor.id,
        },
      }),

      prisma.delivery.count({
        where: {
          vendorId: vendor.id,
          status: "PENDING",
        },
      }),

      prisma.delivery.count({
        where: {
          vendorId: vendor.id,
          status: {
            in: [
              "ASSIGNED",
              "PICKED_UP",
              "IN_TRANSIT",
            ],
          },
        },
      }),

      prisma.delivery.count({
        where: {
          vendorId: vendor.id,
          status: "DELIVERED",
        },
      }),

      prisma.delivery.count({
        where: {
          vendorId: vendor.id,
          status: "CANCELLED",
        },
      }),

      prisma.delivery.findMany({
        where: {
          vendorId: vendor.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 5,
        include: {
          rider: {
            include: {
              user: {
                select: {
                  fullName: true,
                  phone: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      overview: {
        totalDeliveries,
        pendingDeliveries,
        activeDeliveries,
        completedDeliveries,
        cancelledDeliveries,
      },
      recentDeliveries,
    });
  } catch (error) {
    console.error("GET VENDOR OVERVIEW ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch vendor overview",
    });
  }
};


/*
|--------------------------------------------------------------------------
| CREATE DELIVERY
|--------------------------------------------------------------------------
| POST /api/vendor/deliveries
|--------------------------------------------------------------------------
| The vendor is automatically obtained from the logged-in user.
|--------------------------------------------------------------------------
*/
export const createDelivery = async (req, res) => {
  try {
    const {
      recipientName,
      recipientPhone,
      recipientAddress,
      packageType,
      packageWeight,
      deliveryInstructions,
      isPeakHour = false,

      // PRICE CONFIRMATION
      confirmed = false,
    } = req.body;

    // =====================================================
    // 1. VALIDATE DELIVERY DATA
    // =====================================================
    if (
      !recipientName?.trim() ||
      !recipientPhone?.trim() ||
      !recipientAddress?.trim() ||
      !packageType?.trim()
    ) {
      console.log("❌ Validation Error: Missing required fields", {
        recipientName,
        recipientPhone,
        recipientAddress,
        packageType,
      });

      return res.status(400).json({
        success: false,
        message:
          "Recipient name, phone, address, and package type are required",
      });
    }

    // =====================================================
    // 2. FIND VENDOR
    // =====================================================
    const vendor = await prisma.vendorProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!vendor) {
      console.log(
        "❌ Vendor Error: Vendor profile not found for user ID:",
        req.user?.id
      );

      return res.status(404).json({
        success: false,
        message: "Vendor profile not found",
      });
    }

    // =====================================================
    // 3. VALIDATE BUSINESS ADDRESS
    // =====================================================
    if (!vendor.businessAddress?.trim()) {
      console.log("❌ Vendor Error: Business address is missing.");

      return res.status(400).json({
        success: false,
        message:
          "Your business address is required before creating a delivery",
      });
    }

    // =====================================================
    // 4. GEOCODE PICKUP LOCATION
    // =====================================================
    console.log("📍 Geocoding vendor address:", vendor.businessAddress);

    let pickupLocation = await geocodeAddress(vendor.businessAddress);

    if (!pickupLocation) {
      console.log(
        "⚠️ Geocoding failed for Business Address. Using fallback coordinates."
      );

      pickupLocation = {
        latitude: vendor.latitude || 6.5244,
        longitude: vendor.longitude || 3.3792,
        isApproximate: true,
      };
    }

    // Update vendor profile coordinates if missing
    if (!vendor.latitude || !vendor.longitude) {
      await prisma.vendorProfile.update({
        where: { id: vendor.id },
        data: {
          latitude: pickupLocation.latitude,
          longitude: pickupLocation.longitude,
        },
      });
    }

    // =====================================================
    // 5. GEOCODE DROPOFF LOCATION
    // =====================================================
    const cleanedRecipientAddress = recipientAddress.trim();

    console.log("📍 Geocoding recipient address:", cleanedRecipientAddress);

    let deliveryLocation = await geocodeAddress(cleanedRecipientAddress);

    if (!deliveryLocation) {
      console.log(
        "⚠️ Geocoding failed for Recipient Address. Using fallback coordinates."
      );

      deliveryLocation = {
        latitude: 6.4474,
        longitude: 3.4722,
        isApproximate: true,
      };
    }

    // =====================================================
    // 6. CALCULATE ACTUAL ROAD DISTANCE (OSRM)
    // =====================================================
    const route = await getRoadRoute(
      pickupLocation.latitude,
      pickupLocation.longitude,
      deliveryLocation.latitude,
      deliveryLocation.longitude
    );

    if (!route) {
      return res.status(400).json({
        success: false,
        message:
          "Unable to calculate a road route between pickup and destination.",
      });
    }

    const distanceInKm = route.distanceMeters / 1000;

    // =====================================================
    // 7. CALCULATE PRICING VIA PRICING UTILITY
    // =====================================================
    const pricingBreakdown = calculateDeliveryFee({
      distanceInKm,
      isPeakHour: Boolean(isPeakHour),
    });

    const { riderFee, totalFare, systemFee } = pricingBreakdown;

    const pricing = {
      distanceKm: Number(distanceInKm.toFixed(2)),
      riderFee,
      systemFee,
      totalFare,
    };

    // =====================================================
    // 8. PRICE CONFIRMATION STAGE
    // =====================================================
    if (!confirmed) {
      console.log(
        "💰 Price calculated. Waiting for vendor confirmation:",
        pricing
      );

      return res.status(200).json({
        success: true,
        requiresConfirmation: true,
        message:
          "Please confirm the delivery fee before creating the delivery.",
        pricing: {
          totalFare,
          riderFee,
          systemFee: pricing.systemFee,
          distanceKm: pricing.distanceKm,
        },
      });
    }

    // =====================================================
    // 9. GENERATE TRACKING ID & 4-DIGIT PIN
    // =====================================================
    const trackingId = `CXR-${Date.now()}-${Math.floor(
      100 + Math.random() * 900
    )}`;

    const deliveryPin = Math.floor(1000 + Math.random() * 9000).toString();

    console.log("🔐 Delivery PIN generated:", deliveryPin);

    // =====================================================
    // 10. CREATE DELIVERY WITH GEOLOCATION DATA
    // =====================================================
    const delivery = await prisma.delivery.create({
      data: {
        trackingId,
        vendorId: vendor.id,

        recipientName: recipientName.trim(),
        recipientPhone: recipientPhone.trim(),
        recipientAddress: cleanedRecipientAddress,

        // 📍 STORED COORDINATES FOR GEOFENCING & ETA CALCULATIONS
        pickupLatitude: pickupLocation.latitude,
        pickupLongitude: pickupLocation.longitude,
        recipientLatitude: deliveryLocation.latitude,
        recipientLongitude: deliveryLocation.longitude,

        packageType: packageType.trim(),
        packageWeight: packageWeight?.trim() || null,
        deliveryInstructions: deliveryInstructions?.trim() || null,

        riderFee,
        deliveryFee: totalFare,
        deliveryPin,

        status: "PENDING",
      },
    });

    // =====================================================
    // 11. DISPATCH TO NEARBY RIDERS (REUSABLE HELPER)
    // =====================================================
    const closestRiders = await dispatchDeliveryToNearbyRiders(delivery);

    // =====================================================
    // 12. RETURN RESPONSE
    // =====================================================
    return res.status(201).json({
      success: true,
      message:
        closestRiders.length > 0
          ? "Delivery created successfully. Nearby riders have been notified."
          : "Delivery created successfully, but no available riders were found.",
      delivery,
      pricing: {
        totalFare,
        riderFee,
        systemFee,
        distanceKm: pricing.distanceKm,
      },
      pickupLocation,
      deliveryLocation,
      ridersNotified: closestRiders.length,
      closestRiders: closestRiders.map((rider) => ({
        id: rider.id,
        userId: rider.userId,
        user: {
          id: rider.user.id,
          fullName: rider.user.fullName,
          phone: rider.user.phone,
        },
        vehicleNumber: rider.vehicleNumber,
        deliveryArea: rider.deliveryArea,
        isVerified: rider.isVerified,
        isAvailable: rider.isAvailable,
        currentLatitude: rider.currentLatitude,
        currentLongitude: rider.currentLongitude,
        distanceFromPickup: rider.distanceFromPickup,
      })),
    });
  } catch (error) {
    console.error("❌ Create delivery unhandled error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create delivery. Please try again later.",
    });
  }
};
// =========================================
// CHECK DELIVERY ASSIGNMENT STATUS
// =========================================
export const getDeliveryAssignment = async (req, res) => {
  try {
    // Your route is /deliveries/:id/assignment
    const { id: deliveryId } = req.params;

    if (!deliveryId) {
      return res.status(400).json({
        success: false,
        message: "Delivery ID is required",
      });
    }

    // Find the vendor profile belonging to the logged-in user
    const vendor = await prisma.vendorProfile.findUnique({
      where: {
        userId: req.user.id,
      },
    });

    if (!vendor) {
      return res.status(403).json({
        success: false,
        message: "Vendor profile not found",
      });
    }

    const delivery = await prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        vendorId: vendor.id,
      },

      include: {
        rider: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                phone: true,
                username: true,
              },
            },
          },
        },

        deliveryRequests: {
          where: {
            status: "PENDING",
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
            rider: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    phone: true,
                    username: true,
                  },
                },
              },
            },
          },

          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    const pendingRiders = delivery.deliveryRequests.map(
      (request) => ({
        requestId: request.id,

        id: request.rider.id,

        riderId: request.rider.id,

        userId: request.rider.userId,

        user: {
          id: request.rider.user.id,

          fullName:
            request.rider.user.fullName,

          username:
            request.rider.user.username,

          phone:
            request.rider.user.phone,
        },

        name:
          request.rider.user.fullName ||
          request.rider.user.username,

        phone:
          request.rider.user.phone,

        vehicleNumber:
          request.rider.vehicleNumber,

        deliveryArea:
          request.rider.deliveryArea,

        distanceFromPickup:
          request.distanceFromPickup,

        requestStatus:
          request.status,

        expiresAt:
          request.expiresAt,

        isVerified:
          request.rider.isVerified,

        isAvailable:
          request.rider.isAvailable,
      })
    );

    let assignmentStatus = "WAITING";

    if (delivery.rider) {
      assignmentStatus = "ASSIGNED";
    } else if (pendingRiders.length > 0) {
      assignmentStatus = "SEARCHING";
    }

    return res.status(200).json({
      success: true,

      assignment: {
        deliveryId: delivery.id,

        trackingId: delivery.trackingId,

        deliveryStatus: delivery.status,

        status: assignmentStatus,

        rider: delivery.rider
          ? {
              id: delivery.rider.id,

              riderId: delivery.rider.id,

              userId: delivery.rider.userId,

              user: {
                id: delivery.rider.user.id,

                fullName:
                  delivery.rider.user.fullName,

                username:
                  delivery.rider.user.username,

                phone:
                  delivery.rider.user.phone,
              },

              name:
                delivery.rider.user.fullName ||
                delivery.rider.user.username,

              phone:
                delivery.rider.user.phone,

              vehicleNumber:
                delivery.rider.vehicleNumber,

              deliveryArea:
                delivery.rider.deliveryArea,

              isVerified:
                delivery.rider.isVerified,

              isAvailable:
                delivery.rider.isAvailable,
            }
          : null,

        pendingRiders,

        totalRidersSearching:
          pendingRiders.length,
      },
    });
  } catch (error) {
    console.error(
      "Get assignment status error:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to check rider assignment",
    });
  }
};

/*
|--------------------------------------------------------------------------
| GET ALL VENDOR DELIVERIES
|--------------------------------------------------------------------------
| GET /api/vendor/deliveries
|--------------------------------------------------------------------------
*/
export const getVendorDeliveries = async (req, res) => {
  try {
    const userId = req.user.id;

    // =====================================================
    // 1. FIND VENDOR PROFILE
    // =====================================================

    const vendor = await prisma.vendorProfile.findUnique({
      where: {
        userId,
      },
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found",
      });
    }

    // =====================================================
    // 2. FETCH ACTIVE DELIVERIES
    // =====================================================

    const deliveries = await prisma.delivery.findMany({
      where: {
        vendorId: vendor.id,
        status: {
          notIn: ["DELIVERED", "CANCELLED"],
        },
      },

      orderBy: {
        createdAt: "desc",
      },

      include: {
        // =================================================
        // ASSIGNED RIDER
        // =================================================

        rider: {
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                username: true,
                phone: true,
              },
            },
          },
        },

        // =================================================
        // RIDERS CURRENTLY BEING NOTIFIED
        // =================================================

        deliveryRequests: {
          where: {
            status: "PENDING",
            expiresAt: { gt: new Date() }, // Ignore expired requests
          },

          take: 5, // 👈 Limits pending requests to match your 5-rider batch limit

          include: {
            rider: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    username: true,
                    phone: true,
                  },
                },
              },
            },
          },

          orderBy: {
            distanceFromPickup: "asc",
          },
        },

        // =================================================
        // PAYMENT HISTORY
        // =================================================

        payments: {
          orderBy: {
            createdAt: "desc",
          },

          take: 1,
        },
      },
    });

    // =====================================================
    // 3. FORMAT RESPONSE
    // =====================================================

    const formattedDeliveries = deliveries.map((delivery) => {
      // =================================================
      // GET LATEST PAYMENT
      // =================================================

      const payment = delivery.payments?.[0] || null;

      const paymentStatus = payment?.status || "PENDING";

      const deliveryFee = Number(
        delivery.deliveryFee || payment?.amount || 0
      );

      const isPaid = paymentStatus === "SUCCESS";

      // =================================================
      // FORMAT DELIVERY
      // =================================================

      return {
        // =================================================
        // BASIC DELIVERY INFORMATION
        // =================================================

        id: delivery.id,

        _id: delivery.id,

        trackingId: delivery.trackingId,

        recipientName: delivery.recipientName,

        recipientPhone: delivery.recipientPhone,

        recipientAddress: delivery.recipientAddress,

        packageType: delivery.packageType,

        packageWeight:
          delivery.packageWeight || "Standard",

        deliveryInstructions:
          delivery.deliveryInstructions || null,

        // =================================================
        // DELIVERY STATUS
        // =================================================

        status: delivery.status,

        createdAt: delivery.createdAt,

        updatedAt: delivery.updatedAt,

        // =================================================
        // DELIVERY PRICING
        // =================================================

        deliveryFee,

        riderFee: Number(
          delivery.riderFee || 0
        ),

        // =================================================
        // PAYMENT INFORMATION
        // =================================================

        paymentStatus,

        paymentMethod:
          payment?.method || null,

        paymentReference:
          payment?.reference || null,

        paidAt:
          payment?.paidAt || null,

        gatewayTransactionId:
          payment?.gatewayTransactionId || null,

        authorizationUrl:
          payment?.authorizationUrl || null,

        // =================================================
        // PAYMENT HELPERS
        // =================================================

        isPaid,

        requiresPayment: !isPaid,

        canPay: !isPaid,

        // =================================================
        // ASSIGNED RIDER
        // =================================================

        rider: delivery.rider
          ? {
              id: delivery.rider.id,

              name:
                delivery.rider.user?.fullName ||
                delivery.rider.user?.username ||
                "Assigned Rider",

              phone:
                delivery.rider.user?.phone || "",

              vehicle:
                delivery.rider.vehicleNumber ||
                "Vehicle Unspecified",

              deliveryArea:
                delivery.rider.deliveryArea || "",

              isVerified:
                delivery.rider.isVerified,

              isAvailable:
                delivery.rider.isAvailable,
            }
          : null,

        // =================================================
        // RIDERS CURRENTLY SEARCHING FOR DELIVERY
        // =================================================

        deliveryRequests:
          delivery.deliveryRequests.map(
            (request) => ({
              requestId: request.id,

              riderId: request.rider.id,

              name:
                request.rider.user?.fullName ||
                request.rider.user?.username ||
                "Rider",

              phone:
                request.rider.user?.phone || "",

              vehicle:
                request.rider.vehicleNumber ||
                "Vehicle Unspecified",

              deliveryArea:
                request.rider.deliveryArea || "",

              distanceFromPickup:
                request.distanceFromPickup,

              requestStatus:
                request.status,

              expiresAt:
                request.expiresAt,

              isVerified:
                request.rider.isVerified,
            })
          ),
      };
    });

    // =====================================================
    // 4. RETURN RESPONSE
    // =====================================================

    return res.status(200).json({
      success: true,

      count: formattedDeliveries.length,

      deliveries: formattedDeliveries,
    });
  } catch (error) {
    console.error(
      "GET VENDOR DELIVERIES ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to fetch active vendor deliveries",

      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};


/*
|--------------------------------------------------------------------------
| GET SINGLE VENDOR DELIVERY
|--------------------------------------------------------------------------
| GET /api/vendor/deliveries/:id
|--------------------------------------------------------------------------
*/
export const getVendorDeliveryById = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const vendor = await prisma.vendorProfile.findUnique({
      where: {
        userId,
      },
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found",
      });
    }

    const delivery = await prisma.delivery.findFirst({
      where: {
        id,
        vendorId: vendor.id,
      },
      include: {
        rider: {
          include: {
            user: {
              select: {
                fullName: true,
                phone: true,
              },
            },
          },
        },
        vendor: {
          include: {
            user: {
              select: {
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
        success: false,
        message: "Delivery not found",
      });
    }

    return res.status(200).json({
      success: true,
      delivery,
    });
  } catch (error) {
    console.error("GET VENDOR DELIVERY ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch delivery",
    });
  }
};


/*
|--------------------------------------------------------------------------
| UPDATE VENDOR PROFILE
|--------------------------------------------------------------------------
| PUT /api/vendor/profile
|--------------------------------------------------------------------------
*/
export const updateVendorProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      fullName,
      phone,
      businessName,
      businessType,
      businessAddress,
    } = req.body;

    const vendor = await prisma.vendorProfile.findUnique({
      where: {
        userId,
      },
    });

    if (!vendor) {
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found",
      });
    }

    const updatedUser = await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        ...(fullName !== undefined && {
          fullName,
        }),

        ...(phone !== undefined && {
          phone,
        }),
      },
      select: {
        id: true,
        fullName: true,
        username: true,
        email: true,
        phone: true,
        role: true,
      },
    });

    const updatedVendor =
      await prisma.vendorProfile.update({
        where: {
          userId,
        },
        data: {
          ...(businessName !== undefined && {
            businessName,
          }),

          ...(businessType !== undefined && {
            businessType,
          }),

          ...(businessAddress !== undefined && {
            businessAddress,
          }),
        },
      });

    return res.status(200).json({
      success: true,
      message: "Vendor profile updated successfully",
      user: updatedUser,
      vendor: updatedVendor,
    });
  } catch (error) {
    console.error("UPDATE VENDOR PROFILE ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update vendor profile",
    });
  }
};

export const getVendorHistory = async (req, res) => {
  try {
    // =====================================================
    // 1. AUTHENTICATED VENDOR RESOLUTION
    // =====================================================
    let vendorId = req.user?.vendorProfileId;

    if (!vendorId && (req.user?.id || req.user?.userId)) {
      const userId = req.user.id || req.user.userId;
      const vendorProfile = await prisma.vendorProfile.findUnique({
        where: { userId: userId },
      });
      vendorId = vendorProfile?.id;
    }

    if (!vendorId) {
      return res.status(401).json({
        success: false,
        message: "Vendor profile not found for this user account.",
      });
    }

    // =====================================================
    // 2. QUERY PARAMETERS & PAGINATION
    // =====================================================
    const tab = req.query.tab || "deliveries";

    let page = parseInt(req.query.page, 10);
    let limit = parseInt(req.query.limit, 10);

    page = Number.isNaN(page) || page < 1 ? 1 : page;
    limit = Number.isNaN(limit) || limit < 1 ? 10 : limit;

    if (limit > 50) limit = 50;

    const skip = (page - 1) * limit;

    // =====================================================
    // 3. DELIVERY HISTORY TAB (DELIVERED & CANCELLED)
    // =====================================================
    if (tab === "deliveries") {
      const [
        deliveries,
        total,
        completed,
        cancelled,
        pending,
      ] = await prisma.$transaction([
        prisma.delivery.findMany({
          // FILTER: Include both DELIVERED and CANCELLED
          where: { 
            vendorId, 
            status: { in: ["DELIVERED", "CANCELLED"] } 
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          select: {
            id: true,
            trackingId: true,
            recipientName: true,
            recipientPhone: true,
            recipientAddress: true,
            packageType: true,
            packageWeight: true,
            deliveryFee: true,
            riderFee: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            rider: {
              select: {
                id: true,
                vehicleNumber: true,
                user: {
                  select: {
                    fullName: true,
                    phone: true,
                  },
                },
              },
            },
          },
        }),

        prisma.delivery.count({ 
          where: { vendorId, status: { in: ["DELIVERED", "CANCELLED"] } } 
        }),
        prisma.delivery.count({ where: { vendorId, status: "DELIVERED" } }),
        prisma.delivery.count({ where: { vendorId, status: "CANCELLED" } }),
        prisma.delivery.count({
          where: {
            vendorId,
            NOT: {
              status: {
                in: ["DELIVERED", "CANCELLED"],
              },
            },
          },
        }),
      ]);

      return res.status(200).json({
        success: true,
        tab: "deliveries",
        stats: {
          totalDeliveries: total,
          completedDeliveries: completed,
          cancelledDeliveries: cancelled,
          pendingDeliveries: pending,
        },
        data: deliveries,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total,
          nextPage: page * limit < total ? page + 1 : null,
          previousPage: page > 1 ? page - 1 : null,
        },
      });
    }

    // =====================================================
    // 4. PAYMENT HISTORY TAB (SUCCESS & FAILED)
    // =====================================================
    if (tab === "payments") {
      const [
        payments,
        total,
        successfulPayments,
        failedPayments,
        revenue,
      ] = await prisma.$transaction([
        prisma.payment.findMany({
          // FILTER: Include both SUCCESS and FAILED payments
          where: { 
            vendorId, 
            status: { in: ["SUCCESS", "FAILED"] } 
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
          select: {
            id: true,
            reference: true,
            amount: true,
            currency: true,
            status: true,
            method: true,
            authorizationUrl: true,
            paidAt: true,
            failedAt: true,
            createdAt: true,
            delivery: {
              select: {
                trackingId: true,
                recipientName: true,
                status: true,
              },
            },
          },
        }),

        prisma.payment.count({ 
          where: { vendorId, status: { in: ["SUCCESS", "FAILED"] } } 
        }),
        prisma.payment.count({ where: { vendorId, status: "SUCCESS" } }),
        prisma.payment.count({ where: { vendorId, status: "FAILED" } }),
        prisma.payment.aggregate({
          where: { vendorId, status: "SUCCESS" },
          _sum: { amount: true },
        }),
      ]);

      return res.status(200).json({
        success: true,
        tab: "payments",
        stats: {
          totalPayments: total,
          successfulPayments,
          failedPayments,
          totalRevenue: revenue._sum.amount || 0,
        },
        data: payments,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total,
          nextPage: page * limit < total ? page + 1 : null,
          previousPage: page > 1 ? page - 1 : null,
        },
      });
    }

    // =====================================================
    // 5. INVALID TAB FALLBACK
    // =====================================================
    return res.status(400).json({
      success: false,
      message: "Invalid history type. Use 'deliveries' or 'payments'.",
    });
  } catch (error) {
    console.error("\n==============================================");
    console.error("VENDOR HISTORY ERROR");
    console.error("==============================================");
    console.error("Time:", new Date().toISOString());
    console.error("Vendor:", req.user?.vendorProfileId);
    console.error("Tab:", req.query.tab);
    console.error("Page:", req.query.page);
    console.error("Limit:", req.query.limit);

    if (error.code) {
      console.error("Prisma Code:", error.code);
    }

    if (error.meta) {
      console.error("Prisma Meta:", error.meta);
    }

    console.error(error);
    console.error("==============================================\n");

    return res.status(500).json({
      success: false,
      message: "Failed to fetch vendor history.",
      error:
        process.env.NODE_ENV === "development"
          ? error.message
          : undefined,
    });
  }
};
export const cancelVendorDelivery = async (req, res) => {
  try {
    const { id: deliveryId } = req.params;
    const userId = req.user.id; // From auth middleware

    // 1. Find the VendorProfile belonging to this user
    const vendorProfile = await prisma.vendorProfile.findUnique({
      where: { userId: userId },
    });

    if (!vendorProfile) {
      return res.status(403).json({
        success: false,
        message: "Vendor profile not found for this user account.",
      });
    }

    // 2. Fetch the delivery
    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      include: { rider: true },
    });

    if (!delivery) {
      return res.status(404).json({
        success: false,
        message: "Delivery not found.",
      });
    }

    // 3. Check ownership using the VendorProfile ID
    if (delivery.vendorId !== vendorProfile.id) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized to cancel this delivery.",
      });
    }

    // 4. Validate if delivery status allows cancellation
    const nonCancellableStatuses = ["DELIVERED", "COMPLETED", "CANCELLED", "IN_TRANSIT"];
    if (nonCancellableStatuses.includes(delivery.status?.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Delivery cannot be cancelled because its current status is ${delivery.status}.`,
      });
    }

    // 5. Perform the update
    const updatedDelivery = await prisma.delivery.update({
      where: { id: deliveryId },
      data: {
        status: "CANCELLED",
      },
    });

    // 6. Create notification
    await prisma.notification.create({
      data: {
        userId: userId,
        title: "Delivery Cancelled",
        message: `Delivery with tracking ID ${delivery.trackingId || deliveryId} has been successfully cancelled.`,
        type: "DELIVERY",
      },
    });

    return res.status(200).json({
      success: true,
      message: "Delivery cancelled successfully.",
      data: updatedDelivery,
    });
  } catch (error) {
    console.error("Error cancelling delivery:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while cancelling delivery.",
      error: error.message,
    });
  }
};