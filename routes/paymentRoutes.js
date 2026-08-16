import express from "express";

import {
  initiateDeliveryPayment,
  verifyDeliveryPayment,
  handlePaystackWebhook
} from "../controllers/paymentController.js";

import {
  protect,
  authorizeRole,
} from "../middleware/authMiddleware.js";

const router = express.Router();

// =====================================================
// INITIATE DELIVERY PAYMENT
// Vendor starts Paystack payment
// =====================================================

router.post(
  "/initiate",
  protect,
  authorizeRole("VENDOR"),
  initiateDeliveryPayment
);

// =====================================================
// VERIFY DELIVERY PAYMENT
// Paystack reference is verified
// =====================================================

router.get(
  "/verify/:reference",
  protect,
  authorizeRole("VENDOR"),
  verifyDeliveryPayment
);
router.post('/webhook/paystack', handlePaystackWebhook);

export default router;