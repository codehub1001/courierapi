import express from "express";
import {
  getAllRiders,
  toggleRiderVerification,
  updateRiderStatus,
  getAllVendors,
  getAllDeliveries,
  getAdminOverview,
  getPaymentAnalytics,
  adminGetAllVendorsDeliveryHistory,
  adminGetAllVendorsPaymentHistory,
  adminGetAllRidersPayoutHistory
} from "../controllers/adminControllers.js";
import { protect, authorizeRole } from "../middleware/authMiddleware.js";

// Optional: Import your auth/admin middleware if these are protected routes
// import { protect, adminOnly } from "../middleware/authMiddleware.js";

const router = express.Router();

// ─────────────────────────────────────────────
// ADMIN / MANAGEMENT ROUTES
// ─────────────────────────────────────────────
router.get("/overview", getAdminOverview);

// Rider Management
router.get("/riders", getAllRiders); // Supports query: ?status=online or ?status=offline
router.patch("/riders/:id/verify", toggleRiderVerification); // Toggle approve/revoke verification
router.patch("/riders/:id/status", updateRiderStatus); // Change status (ACTIVE, IDLE, PENDING_VERIFICATION, SUSPENDED)

// Vendor Management
router.get("/vendors", getAllVendors);

// Delivery Management
router.get("/deliveries", getAllDeliveries);
router.get(
  "/analytics/payments",

  getPaymentAnalytics
);
router.get("/vendors/deliveries/history", adminGetAllVendorsDeliveryHistory);
router.get("/vendors/payments/history", adminGetAllVendorsPaymentHistory);
router.get("/riders/payouts/history", adminGetAllRidersPayoutHistory);
export default router;