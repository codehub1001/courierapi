import express from "express";
import { receiveWhatsAppMessage, sendWhatsAppMessage, updateWhatsAppStatus } from "../controllers/whatsappControllers.js";

const router = express.Router();

/**
 * =========================================================
 * META WHATSAPP WEBHOOK VERIFICATION (GET)
 * =========================================================
 */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  console.log("📱 WhatsApp webhook verification request");

  if (!verifyToken) {
    console.error("❌ WHATSAPP_VERIFY_TOKEN is missing from environment variables");
    return res.sendStatus(500);
  }

  if (mode === "subscribe" && token === verifyToken) {
    console.log("✅ WhatsApp webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.error("❌ WhatsApp webhook verification failed");
  return res.sendStatus(403);
});

/**
 * =========================================================
 * META WHATSAPP WEBHOOK EVENT PROCESSOR (POST)
 * =========================================================
 */
router.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") {
      console.log("⚠️ Unknown webhook object");
      return res.sendStatus(404);
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;

        // 1. Process Message Status Updates (sent, delivered, read, failed)
        if (value?.statuses) {
          for (const status of value.statuses) {
            await updateWhatsAppStatus(status);
          }
        }

        // 2. Process Incoming Messages
        if (value?.messages) {
          await receiveWhatsAppMessage(req, res);
          return;
        }
      }
    }

    return res.sendStatus(200);

  } catch (error) {
    console.error("❌ WhatsApp webhook processing error:", error);
    return res.sendStatus(200);
  }
});

/**
 * =========================================================
 * OUTBOUND WHATSAPP MESSAGE DISPATCH (POST)
 * =========================================================
 */
router.post("/send", async (req, res) => {
  try {
    const { recipientPhone, messageText, deliveryId } = req.body;

    if (!recipientPhone || !messageText) {
      return res.status(400).json({ error: "recipientPhone and messageText are required" });
    }

    const result = await sendWhatsAppMessage(recipientPhone, messageText, deliveryId);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export default router;