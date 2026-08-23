import express from "express";

import {
  registerUser,
  loginUser,
  changePassword,
  forgotPassword,
  resetPassword
} from "../controllers/userControllers.js";
import { protect, authorizeRole } from "../middleware/authMiddleware.js";
const router = express.Router();


// Register vendor or rider
router.post("/register", registerUser);


// Login admin, vendor, or rider
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Protected routes (Requires valid JWT token)
router.put("/change-password", protect, changePassword);


export default router;