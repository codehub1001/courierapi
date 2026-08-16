import express from "express";
import {
  getRiderProfile,
  updateRiderProfile,
  toggleAvailability,
  updateLocation,
  getPendingRequests,
  acceptDeliveryRequest,
  rejectDeliveryRequest,
  getActiveDelivery,
  updateDeliveryStatus,
  getDeliveryHistory,
} from "../controllers/riderController.js";

// Import your auth middleware
import { protect, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// ─────────────────────────────────────────────
// GLOBAL MIDDLEWARE FOR ALL RIDER ROUTES
// ─────────────────────────────────────────────
router.use(protect);
router.use(authorizeRole("RIDER"));

// ─────────────────────────────────────────────
// PROFILE & STATUS ROUTES
// ─────────────────────────────────────────────

// GET /api/v1/rider/profile -> Fetch rider details, stats, and wallet
router.get("/profile", getRiderProfile);

// PUT /api/v1/rider/profile -> Update rider profile, vehicle specs, and bank payout details
router.put("/profile", updateRiderProfile);

// PATCH /api/v1/rider/availability -> Toggle ONLINE / OFFLINE status
router.patch("/availability", toggleAvailability);

// PATCH /api/v1/rider/location -> Send live GPS telemetry (lat/lng)
router.patch("/location", updateLocation);


// ─────────────────────────────────────────────
// DELIVERY REQUEST ROUTES (JOB OFFERS)
// ─────────────────────────────────────────────

// GET /api/v1/rider/requests/pending -> View available job broadcasts
router.get("/requests/pending", getPendingRequests);

// POST /api/v1/rider/requests/:requestId/accept -> Atomically accept a delivery
router.post("/requests/:requestId/accept", acceptDeliveryRequest);

// POST /api/v1/rider/requests/:requestId/reject -> Decline a delivery offer
router.post("/requests/:requestId/reject", rejectDeliveryRequest);


// ─────────────────────────────────────────────
// ACTIVE DELIVERY & HISTORY ROUTES
// ─────────────────────────────────────────────

// GET /api/v1/rider/deliveries/active -> Get currently assigned/in-progress delivery
router.get("/deliveries/active", getActiveDelivery);

// PATCH /api/v1/rider/deliveries/:deliveryId/status -> Advance state (PICKED_UP -> DELIVERED)
router.patch("/deliveries/:deliveryId/status", updateDeliveryStatus);

// GET /api/v1/rider/deliveries/history -> Paginated list of completed/cancelled jobs
router.get("/deliveries/history", getDeliveryHistory);

export default router;