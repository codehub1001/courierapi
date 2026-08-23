import express from "express";
import { 
  createSupportTicket, 
  getAllSupportTickets, 
  updateTicketStatus 
} from "../controllers/supportController.js";
import { protect, authorizeRole } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public route to submit ticket from Contact form
router.post("/tickets", createSupportTicket);

// Admin-only routes
router.get("/tickets", protect, authorizeRole("ADMIN"), getAllSupportTickets);
router.patch("/tickets/:id/status", protect, authorizeRole("ADMIN"), updateTicketStatus);

export default router;