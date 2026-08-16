import express from "express";
import { trackPackage } from "../controllers/deliveryController.js";

const router = express.Router();

// Public route for anyone to track a shipment
router.get("/track/:trackingId", trackPackage);

export default router;