import express from "express";

import {
  getVendorProfile,
  getVendorOverview,
  createDelivery,
  getVendorDeliveries,
  getVendorDeliveryById,
  getDeliveryAssignment,
  updateVendorProfile,
  getVendorHistory
} from "../controllers/vendorControllers.js";

import { protect,authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

/*
|--------------------------------------------------------------------------
| VENDOR PROFILE
|--------------------------------------------------------------------------
*/

// Get logged-in vendor profile
router.get(
  "/profile",
  protect,
  getVendorProfile
);

// Update logged-in vendor profile
router.put(
  "/profile",
  protect,
  updateVendorProfile
);


/*
|--------------------------------------------------------------------------
| VENDOR DASHBOARD
|--------------------------------------------------------------------------
*/

// Get vendor dashboard overview
router.get(
  "/overview",
  protect,
  getVendorOverview
);


/*
|--------------------------------------------------------------------------
| VENDOR DELIVERIES
|--------------------------------------------------------------------------
*/

// Create a new delivery
router.post(
  "/deliveries",
  protect,
  createDelivery
);

// Get all deliveries belonging to logged-in vendor
router.get(
  "/deliveries",
  protect,
  getVendorDeliveries
);

// Get one specific delivery
router.get(
  "/deliveries/:id",
  protect,
  getVendorDeliveryById
);
router.get(
  "/deliveries/:id/assignment",
  protect,
  getDeliveryAssignment
);
router.get('/history', protect, getVendorHistory);

export default router;