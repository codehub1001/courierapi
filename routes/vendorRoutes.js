import express from "express";

import {
  getVendorProfile,
  getVendorOverview,
  createDelivery,
  getVendorDeliveries,
  getVendorDeliveryById,
  getDeliveryAssignment,
  updateVendorProfile,
  getVendorHistory,
  cancelVendorDelivery // 1. Import the controller here
} from "../controllers/vendorControllers.js";

import { protect, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| VENDOR PROFILE
|--------------------------------------------------------------------------
*/

router.get("/profile", protect, getVendorProfile);
router.put("/profile", protect, updateVendorProfile);

/*
|--------------------------------------------------------------------------
| VENDOR DASHBOARD
|--------------------------------------------------------------------------
*/

router.get("/overview", protect, getVendorOverview);

/*
|--------------------------------------------------------------------------
| VENDOR DELIVERIES
|--------------------------------------------------------------------------
*/

router.post("/deliveries", protect, createDelivery);
router.get("/deliveries", protect, getVendorDeliveries);
router.get("/deliveries/:id", protect, getVendorDeliveryById);
router.get("/deliveries/:id/assignment", protect, getDeliveryAssignment);

// 2. Add the cancel delivery route here
router.patch("/deliveries/:id/cancel", protect, cancelVendorDelivery);

router.get('/history', protect, getVendorHistory);

export default router;