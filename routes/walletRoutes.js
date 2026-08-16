import express from "express";

import {
  getMyWallet,
  getWalletBalance,
  getWalletTransactions,
  debitWallet,
} from "../controllers/walletControllers.js";

import {
  protect,
  authorizeRole,
} from "../middleware/authMiddleware.js";

const router = express.Router();

router.get(
  "/",
  protect,
  authorizeRole("RIDER"),
  getMyWallet
);

router.get(
  "/balance",
  protect,
  authorizeRole("RIDER"),
  getWalletBalance
);

router.get(
  "/transactions",
  protect,
  authorizeRole("RIDER"),
  getWalletTransactions
);

router.post(
  "/debit",
  protect,
  authorizeRole("RIDER"),
  debitWallet
);

export default router;