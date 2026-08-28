
import express from "express";

const router = express.Router();

/**
 * =========================================================
 * META WHATSAPP WEBHOOK VERIFICATION
 * =========================================================
 *
 * Meta calls this endpoint when you configure the webhook.
 *
 * GET /api/whatsapp/webhook
 */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  console.log("📱 WhatsApp webhook verification request");

  if (!verifyToken) {
    console.error(
      "❌ WHATSAPP_VERIFY_TOKEN is missing from environment variables"
    );

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
 * META WHATSAPP WEBHOOK
 * =========================================================
 *
 * Meta sends message status updates here.
 *
 * POST /api/whatsapp/webhook
 */
router.post("/webhook", async (req, res) => {
  try {
    console.log("\n======================================");
    console.log("📱 WHATSAPP WEBHOOK RECEIVED");
    console.log("======================================");

    console.log(
      JSON.stringify(req.body, null, 2)
    );

    const body = req.body;

    /**
     * -------------------------------------------------------
     * Make sure this is a WhatsApp webhook
     * -------------------------------------------------------
     */
    if (body.object !== "whatsapp_business_account") {
      console.log("⚠️ Unknown webhook object");

      return res.sendStatus(404);
    }

    /**
     * -------------------------------------------------------
     * Loop through webhook entries
     * -------------------------------------------------------
     */
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;

        /**
         * ---------------------------------------------------
         * MESSAGE STATUS UPDATES
         * ---------------------------------------------------
         */
        if (value?.statuses) {
          for (const status of value.statuses) {
            console.log("\n📨 WHATSAPP MESSAGE STATUS");
            console.log("--------------------------------------");

            console.log("Message ID:", status.id);
            console.log("Recipient:", status.recipient_id);
            console.log("Status:", status.status);
            console.log("Timestamp:", status.timestamp);

            /**
             * Possible statuses:
             *
             * sent
             * delivered
             * read
             * failed
             */

            if (status.status === "sent") {
              console.log("📤 Message sent to WhatsApp");
            }

            if (status.status === "delivered") {
              console.log("✅ Message DELIVERED to recipient");
            }

            if (status.status === "read") {
              console.log("👀 Message READ by recipient");
            }

            if (status.status === "failed") {
              console.error("❌ Message FAILED");

              console.error(
                "Errors:",
                JSON.stringify(
                  status.errors || [],
                  null,
                  2
                )
              );
            }

            console.log("--------------------------------------");
          }
        }

        /**
         * ---------------------------------------------------
         * INCOMING MESSAGES
         * ---------------------------------------------------
         *
         * This is useful later if you want customers/riders
         * to communicate with CourierX through WhatsApp.
         */
        if (value?.messages) {
          for (const message of value.messages) {
            console.log("\n💬 INCOMING WHATSAPP MESSAGE");
            console.log("--------------------------------------");

            console.log("From:", message.from);
            console.log("Message ID:", message.id);
            console.log("Type:", message.type);

            if (message.text?.body) {
              console.log("Message:", message.text.body);
            }

            console.log("--------------------------------------");
          }
        }
      }
    }

    /**
     * IMPORTANT:
     * Meta expects a quick 200 response.
     */
    return res.sendStatus(200);

  } catch (error) {
    console.error(
      "❌ WhatsApp webhook processing error:",
      error
    );

    /**
     * Still return 200 so Meta doesn't repeatedly retry
     * because of a temporary processing error.
     */
    return res.sendStatus(200);
  }
});

export default router;
