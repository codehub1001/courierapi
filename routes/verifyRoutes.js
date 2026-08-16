import express from "express";
import { verifyRiderProfile } from "../controllers/verifyController.js"; 
import { protect, authorizeRole } from "../middleware/authmiddleware.js"; 

const router = express.Router();

// POST: /api/verify (or /api/v1/verify depending on server mount)
router.post("/verify", protect, authorizeRole("RIDER"), verifyRiderProfile);

export default router;