import { createHash, randomInt } from "node:crypto";
import prisma from "../prismaClient.js";
import { geocodeAddress, isInsideLagosBounds } from "../utils/geocodeAddress.js";
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
| CREATE DELIVERY — helpers (module-private)
|--------------------------------------------------------------------------
| Two-step flow on POST /api/vendor/deliveries:
|   confirmed=false -> quote            confirmed=true -> create + dispatch
|
| Location policy (geocoder precision -> action):
|   EXACT / STREET   accepted ("right street, house number unverified").
|   AREA / not found rejected: LOCATION_NEEDS_CONFIRMATION / ADDRESS_NOT_FOUND.
|                    The AREA response carries `suggestedLocation` to centre a map on.
|   pickupCoordinates / recipientCoordinates ({ latitude, longitude })
|                    a customer-confirmed pin overrides geocoding (must be inside Lagos).
|
| Optional: send `confirmedTotalFare` (the totalFare from the quote) with confirmed=true.
| If the fare has moved since the quote, the request is refused with 409 PRICE_CHANGED.
|
| Errors keep the original { success: false, message, location? } shape and add `code`.
|--------------------------------------------------------------------------
*/

const MAX_LEN = {
  name: 100,
  address: 300, // matches the geocoder's limit
  packageType: 60,
  packageWeight: 40,
  instructions: 500,
};

const MAX_DELIVERY_DISTANCE_KM =
  Number(process.env.MAX_DELIVERY_DISTANCE_KM) || 100;
const FARE_TOLERANCE = 0.005; // naira
const DUPLICATE_WINDOW_MS = 30_000;
const TRACKING_ID_ATTEMPTS = 3;

class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const toNumber = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return NaN;
};

const round6 = (n) => Math.round(n * 1e6) / 1e6;

const requiredText = (value, field, label, max) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new ApiError(400, "INVALID_INPUT", `${label} is required.`, { field });
  }
  const text = value.trim();
  if (text.length > max) {
    throw new ApiError(
      400,
      "INVALID_INPUT",
      `${label} must be at most ${max} characters.`,
      { field }
    );
  }
  return text;
};

// Same leniency as before: anything that isn't text becomes null (numbers are kept as text).
const optionalText = (value, field, label, max) => {
  const raw =
    typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;
  if (text.length > max) {
    throw new ApiError(
      400,
      "INVALID_INPUT",
      `${label} must be at most ${max} characters.`,
      { field }
    );
  }
  return text;
};

// Validates only; the phone is stored exactly as the vendor typed it (trimmed).
const isPlausiblePhone = (value) => {
  if (!/^\+?[\d\s\-().]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
};

const parsePin = (raw, field) => {
  if (raw === undefined || raw === null) return null;
  const latitude = toNumber(raw?.latitude);
  const longitude = toNumber(raw?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ApiError(400, "INVALID_COORDINATES", "The selected map point is invalid.", { field });
  }
  if (!isInsideLagosBounds(latitude, longitude)) {
    throw new ApiError(
      400,
      "OUTSIDE_SERVICE_AREA",
      "The selected map point is outside our Lagos delivery area.",
      { field }
    );
  }
  return { latitude: round6(latitude), longitude: round6(longitude) };
};

const parseCreateDeliveryInput = (body) => {
  const b = body && typeof body === "object" ? body : {};

  const recipientName = requiredText(b.recipientName, "recipientName", "Recipient name", MAX_LEN.name);

  const recipientPhone = requiredText(b.recipientPhone, "recipientPhone", "Recipient phone", 32);
  if (!isPlausiblePhone(recipientPhone)) {
    throw new ApiError(400, "INVALID_PHONE", "Please enter a valid phone number for the recipient.", {
      field: "recipientPhone",
    });
  }

  const recipientAddress = requiredText(b.recipientAddress, "recipientAddress", "Recipient address", MAX_LEN.address);
  const packageType = requiredText(b.packageType, "packageType", "Package type", MAX_LEN.packageType);

  let customPickupAddress = null;
  if (b.pickupAddress !== undefined && b.pickupAddress !== null) {
    if (typeof b.pickupAddress !== "string") {
      throw new ApiError(400, "INVALID_INPUT", "The custom pickup address must be a valid string.", {
        field: "pickupAddress",
      });
    }
    customPickupAddress = b.pickupAddress.trim() || null;
    if (customPickupAddress && customPickupAddress.length > MAX_LEN.address) {
      throw new ApiError(
        400,
        "INVALID_INPUT",
        `Pickup address must be at most ${MAX_LEN.address} characters.`,
        { field: "pickupAddress", location: "pickup" }
      );
    }
  }

  const confirmed = b.confirmed ?? false;
  if (typeof confirmed !== "boolean") {
    throw new ApiError(400, "INVALID_INPUT", "The confirmed field must be a boolean.", { field: "confirmed" });
  }

  const isPeakHour = b.isPeakHour ?? false;
  if (typeof isPeakHour !== "boolean") {
    throw new ApiError(400, "INVALID_INPUT", "The isPeakHour field must be a boolean.", { field: "isPeakHour" });
  }

  let confirmedTotalFare = null;
  if (b.confirmedTotalFare !== undefined && b.confirmedTotalFare !== null) {
    confirmedTotalFare = toNumber(b.confirmedTotalFare);
    if (!Number.isFinite(confirmedTotalFare) || confirmedTotalFare <= 0) {
      throw new ApiError(400, "INVALID_INPUT", "The confirmedTotalFare field must be a positive number.", {
        field: "confirmedTotalFare",
      });
    }
  }

  return {
    recipientName,
    recipientPhone,
    recipientAddress,
    packageType,
    packageWeight: optionalText(b.packageWeight, "packageWeight", "Package weight", MAX_LEN.packageWeight),
    deliveryInstructions: optionalText(
      b.deliveryInstructions,
      "deliveryInstructions",
      "Delivery instructions",
      MAX_LEN.instructions
    ),
    customPickupAddress,
    pickupCoordinates: parsePin(b.pickupCoordinates, "pickupCoordinates"),
    recipientCoordinates: parsePin(b.recipientCoordinates, "recipientCoordinates"),
    isPeakHour,
    confirmed,
    confirmedTotalFare,
  };
};

const LOCATION_COPY = {
  pickup: {
    notFound:
      "We couldn't verify your pickup address. Please enter a more specific address or select the pickup point on a map.",
    needsPin:
      "We could only place your pickup address to the nearest area. Please confirm the exact pickup point on the map.",
  },
  recipient: {
    notFound:
      "We couldn't verify the recipient's address. Please enter a more specific address or select the drop-off point on a map.",
    needsPin:
      "We could only place the recipient's address to the nearest area. Please confirm the exact drop-off point on the map.",
  },
};

const resolveLocation = async ({ role, address, pin }) => {
  // A customer-confirmed pin is authoritative and saves an upstream geocoding call.
  if (pin) {
    return {
      latitude: pin.latitude,
      longitude: pin.longitude,
      displayName: address,
      precision: "EXACT",
      isApproximate: false,
      source: "USER_CONFIRMED_PIN",
    };
  }

  const geocoded = await geocodeAddress(address); // never throws; null when unresolved

  if (!geocoded) {
    throw new ApiError(400, "ADDRESS_NOT_FOUND", LOCATION_COPY[role].notFound, { location: role });
  }

  if (geocoded.precision !== "EXACT" && geocoded.precision !== "STREET") {
    throw new ApiError(400, "LOCATION_NEEDS_CONFIRMATION", LOCATION_COPY[role].needsPin, {
      location: role,
      suggestedLocation: {
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        precision: geocoded.precision,
        source: geocoded.source,
      },
    });
  }

  return geocoded;
};

// Same format as before (CXR-<ms>-<3 digits>) but from a CSPRNG; collisions are retried.
const generateTrackingId = () => `CXR-${Date.now()}-${randomInt(100, 1000)}`;
const generateDeliveryPin = () => String(randomInt(1000, 10000));

const hasValidStoredCoordinates = (vendor) => {
  if (vendor.latitude == null || vendor.longitude == null) return false;
  const lat = Number(vendor.latitude);
  const lon = Number(vendor.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && isInsideLagosBounds(lat, lon);
};

// Per-process guard against double-clicks / client retries creating the same delivery twice.
// For multi-instance deployments, back this with an Idempotency-Key column + unique index.
const recentCreates = new Map(); // fingerprint -> { promise, expiresAt }

const purgeExpiredCreates = () => {
  const now = Date.now();
  for (const [key, entry] of recentCreates) {
    if (entry.expiresAt <= now) recentCreates.delete(key);
  }
};

const createDeliveryRecord = async ({ vendor, input, pickupAddress, pickupLocation, deliveryLocation, pricing }) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.delivery.create({
        data: {
          trackingId: generateTrackingId(),
          vendorId: vendor.id,

          recipientName: input.recipientName,
          recipientPhone: input.recipientPhone,
          recipientAddress: input.recipientAddress,

          pickupAddress,
          pickupLatitude: pickupLocation.latitude,
          pickupLongitude: pickupLocation.longitude,

          recipientLatitude: deliveryLocation.latitude,
          recipientLongitude: deliveryLocation.longitude,

          packageType: input.packageType,
          packageWeight: input.packageWeight,
          deliveryInstructions: input.deliveryInstructions,

          riderFee: pricing.riderFee,
          deliveryFee: pricing.totalFare,
          deliveryPin: generateDeliveryPin(),

          status: "PENDING",
        },
      });
    } catch (error) {
      // Unique-constraint collision (tracking ID): regenerate and retry.
      if (error?.code === "P2002" && attempt < TRACKING_ID_ATTEMPTS) continue;
      throw error;
    }
  }
};

const createAndDispatch = async (ctx) => {
  const { log, vendor, usingDefaultPickup, pickupLocation, deliveryLocation, pricing } = ctx;

  const delivery = await createDeliveryRecord(ctx);

  // Best-effort: remember a *verified* default pickup point (EXACT or customer-confirmed pin).
  if (usingDefaultPickup && pickupLocation.precision === "EXACT" && !hasValidStoredCoordinates(vendor)) {
    try {
      await prisma.vendorProfile.update({
        where: { id: vendor.id },
        data: { latitude: pickupLocation.latitude, longitude: pickupLocation.longitude },
      });
    } catch (error) {
      log.warn({ vendorId: vendor.id, err: error?.message }, "Could not save vendor coordinates");
    }
  }

  // The delivery already exists: a dispatch failure must not surface as a creation failure,
  // or the client will retry and create duplicates.
  let closestRiders = [];
  try {
    const result = await dispatchDeliveryToNearbyRiders(delivery);
    closestRiders = Array.isArray(result) ? result : [];
  } catch (error) {
    log.error(
      { deliveryId: delivery.id, trackingId: delivery.trackingId, err: error?.message },
      "Delivery created but rider dispatch failed"
    );
  }

  log.info(
    { deliveryId: delivery.id, trackingId: delivery.trackingId, ridersNotified: closestRiders.length },
    "Delivery created"
  );

  return {
    status: 201,
    body: {
      success: true,
      message:
        closestRiders.length > 0
          ? "Delivery created successfully. Nearby riders have been notified."
          : "Delivery created successfully. No riders were notified yet.",
      delivery,
      pricing: {
        totalFare: pricing.totalFare,
        riderFee: pricing.riderFee,
        systemFee: pricing.systemFee,
        distanceKm: pricing.distanceKm,
      },
      pickupLocation,
      deliveryLocation,
      ridersNotified: closestRiders.length,
      closestRiders: closestRiders.map((rider) => ({
        id: rider.id,
        userId: rider.userId,
        user: rider.user
          ? {
              id: rider.user.id,
              fullName: rider.user.fullName,
              phone: rider.user.phone,
            }
          : null,
        vehicleNumber: rider.vehicleNumber,
        deliveryArea: rider.deliveryArea,
        isVerified: rider.isVerified,
        isAvailable: rider.isAvailable,
        currentLatitude: rider.currentLatitude,
        currentLongitude: rider.currentLongitude,
        distanceFromPickup: rider.distanceFromPickup,
      })),
    },
  };
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
  const log = req.log ?? console;

  try {
    // 1. Auth + input ------------------------------------------------------
    const userId = req.user?.id;
    if (!userId) {
      throw new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    const input = parseCreateDeliveryInput(req.body);

    // 2. Vendor ------------------------------------------------------------
    const vendor = await prisma.vendorProfile.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new ApiError(404, "VENDOR_NOT_FOUND", "Vendor profile not found.");
    }

    // 3. Pickup address ----------------------------------------------------
    const usingDefaultPickup = !input.customPickupAddress;
    const pickupAddress =
      input.customPickupAddress ?? String(vendor.businessAddress ?? "").trim();

    if (!pickupAddress) {
      throw new ApiError(
        400,
        "PICKUP_ADDRESS_REQUIRED",
        "A pickup address is required. Please update your business address or enter a pickup address."
      );
    }
    if (pickupAddress.length > MAX_LEN.address) {
      throw new ApiError(
        400,
        "INVALID_INPUT",
        `Pickup address must be at most ${MAX_LEN.address} characters.`,
        { field: "pickupAddress", location: "pickup" }
      );
    }

    // 4. Resolve both points (a pickup problem is reported first) ------------
    const [pickupResult, recipientResult] = await Promise.allSettled([
      resolveLocation({ role: "pickup", address: pickupAddress, pin: input.pickupCoordinates }),
      resolveLocation({ role: "recipient", address: input.recipientAddress, pin: input.recipientCoordinates }),
    ]);
    if (pickupResult.status === "rejected") throw pickupResult.reason;
    if (recipientResult.status === "rejected") throw recipientResult.reason;

    const pickupLocation = pickupResult.value;
    const deliveryLocation = recipientResult.value;

    // 5. Road distance -----------------------------------------------------
    let route;
    try {
      route = await getRoadRoute(
        pickupLocation.latitude,
        pickupLocation.longitude,
        deliveryLocation.latitude,
        deliveryLocation.longitude
      );
    } catch (error) {
      log.warn({ err: error?.message }, "Routing service error");
      route = null;
    }

    if (!route || !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0) {
      throw new ApiError(
        400,
        "ROUTE_UNAVAILABLE",
        "We couldn't calculate a valid road route between the pickup and destination. Please verify both addresses and try again."
      );
    }

    const distanceInKm = route.distanceMeters / 1000;

    if (distanceInKm > MAX_DELIVERY_DISTANCE_KM) {
      throw new ApiError(
        400,
        "DISTANCE_TOO_LONG",
        `This delivery is beyond our maximum distance of ${MAX_DELIVERY_DISTANCE_KM} km. Please check both addresses.`
      );
    }

    // 6. Price -------------------------------------------------------------
    const pricingBreakdown = calculateDeliveryFee({
      distanceInKm,
      isPeakHour: input.isPeakHour,
    });

    const { riderFee, totalFare, systemFee } = pricingBreakdown ?? {};

    if (
      !Number.isFinite(riderFee) ||
      !Number.isFinite(totalFare) ||
      !Number.isFinite(systemFee) ||
      riderFee <= 0 ||
      systemFee < 0 ||
      totalFare < riderFee
    ) {
      log.error({ vendorId: vendor.id, distanceInKm }, "Invalid pricing breakdown");
      throw new ApiError(500, "PRICING_FAILED", "We couldn't calculate the delivery fee. Please try again.");
    }

    const pricing = {
      distanceKm: Number(distanceInKm.toFixed(2)),
      riderFee,
      systemFee,
      totalFare,
    };

    // 7. Quote -------------------------------------------------------------
    if (!input.confirmed) {
      log.info(
        {
          vendorId: vendor.id,
          distanceKm: pricing.distanceKm,
          totalFare,
          pickupPrecision: pickupLocation.precision,
          recipientPrecision: deliveryLocation.precision,
        },
        "Delivery quote calculated"
      );

      return res.status(200).json({
        success: true,
        requiresConfirmation: true,
        message: "Please confirm the delivery fee before creating the delivery.",
        pricing,
      });
    }

    // 8. If the client says which fare it confirmed, it must still be the fare --
    if (
      input.confirmedTotalFare !== null &&
      Math.abs(totalFare - input.confirmedTotalFare) > FARE_TOLERANCE
    ) {
      throw new ApiError(
        409,
        "PRICE_CHANGED",
        "The delivery fee has changed since your quote. Please review the new fee and confirm again.",
        { requiresConfirmation: true, pricing }
      );
    }

    // 9. Create (once) and dispatch -----------------------------------------
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          vendor.id,
          input.recipientName,
          input.recipientPhone,
          input.recipientAddress,
          input.packageType,
          pickupAddress,
          pickupLocation.latitude,
          pickupLocation.longitude,
          deliveryLocation.latitude,
          deliveryLocation.longitude,
          totalFare,
        ])
      )
      .digest("hex");

    purgeExpiredCreates();

    const existing = recentCreates.get(fingerprint);
    if (existing) {
      let replay = null;
      try {
        replay = await existing.promise;
      } catch {
        // The first attempt failed; fall through and try again ourselves.
      }
      if (replay) {
        return res.status(replay.status).json({ ...replay.body, idempotentReplay: true });
      }
    }

    const job = createAndDispatch({
      log,
      vendor,
      input,
      pickupAddress,
      usingDefaultPickup,
      pickupLocation,
      deliveryLocation,
      pricing,
    });
    recentCreates.set(fingerprint, { promise: job, expiresAt: Date.now() + DUPLICATE_WINDOW_MS });

    let result;
    try {
      result = await job;
    } catch (error) {
      recentCreates.delete(fingerprint);
      throw error;
    }

    return res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.status).json({
        success: false,
        code: error.code,
        message: error.message,
        ...error.extra,
      });
    }

    log.error({ err: error, requestId: req.id }, "Create delivery error");

    return res.status(500).json({
      success: false,
      code: "INTERNAL_ERROR",
      message: "Failed to create delivery. Please try again later.",
      ...(req.id ? { requestId: String(req.id) } : {}),
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