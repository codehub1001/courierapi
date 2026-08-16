import axios from "axios";
import crypto from "crypto";
import prisma from "../prismaClient.js";
import { sendWhatsAppMessage } from "../utils/whatsappCloudService.js";

// =====================================================
// PAYSTACK CONFIG
// =====================================================

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY?.trim();
const PAYSTACK_BASE_URL = "https://api.paystack.co";

// =====================================================
// INITIATE DELIVERY PAYMENT
// =====================================================

export const initiateDeliveryPayment = async (req, res) => {
  try {
    const { deliveryId } = req.body;
    const userId = req.user.id;

    console.log(`\n==================================================`);
    console.log(`🚀 [PAYSTACK INIT] Starting payment for Delivery ID: ${deliveryId}`);
    console.log(`==================================================`);

    if (!deliveryId) {
      console.warn("⚠️ [PAYSTACK INIT] Failed: Delivery ID is missing from request body.");
      return res.status(400).json({
        success: false,
        message: "Delivery ID is required",
      });
    }

    // 1. FIND VENDOR
    console.log(`🔍 [PAYSTACK INIT] Step 1: Looking up vendor profile for User ID: ${userId}...`);
    const vendor = await prisma.vendorProfile.findUnique({
      where: { userId },
      include: { user: true },
    });

    if (!vendor) {
      console.error("❌ [PAYSTACK INIT] Failed: Vendor profile not found.");
      return res.status(404).json({
        success: false,
        message: "Vendor profile not found",
      });
    }

    // 2. FIND DELIVERY
    console.log(`🔍 [PAYSTACK INIT] Step 2: Looking up delivery record...`);
    const delivery = await prisma.delivery.findFirst({
      where: {
        id: deliveryId,
        vendorId: vendor.id,
      },
    });

    if (!delivery) {
      console.error(`❌ [PAYSTACK INIT] Failed: Delivery ${deliveryId} not found for Vendor ${vendor.id}.`);
      return res.status(404).json({
        success: false,
        message: "Delivery not found",
      });
    }

    // =====================================================
    // 🔒 GUARD: RIDER MUST ACCEPT BEFORE PAYMENT
    // =====================================================
    console.log(`🛡️ [PAYSTACK INIT] Step 3: Checking rider assignment (Rider ID: ${delivery.riderId || "NONE"}, Status: ${delivery.status})...`);
    if (!delivery.riderId || delivery.status === "PENDING") {
      console.warn("⚠️ [PAYSTACK INIT] Blocked: No rider has accepted this delivery yet.");
      return res.status(400).json({
        success: false,
        message:
          "A rider has not accepted this delivery yet. Please wait for a rider to accept before proceeding with payment.",
      });
    }

    // 3. CHECK EXISTING PAYMENT
    console.log(`🔍 [PAYSTACK INIT] Step 4: Checking for duplicate successful payments...`);
    const existingPayment = await prisma.payment.findFirst({
      where: {
        deliveryId: delivery.id,
        status: "SUCCESS",
      },
    });

    if (existingPayment) {
      console.warn(`⚠️ [PAYSTACK INIT] Blocked: Delivery already paid (Payment Reference: ${existingPayment.reference}).`);
      return res.status(400).json({
        success: false,
        message: "This delivery has already been paid for",
      });
    }

    // 4. DETERMINE & VALIDATE PAYMENT AMOUNT
    console.log(`💰 [PAYSTACK INIT] Step 5: Calculating payment amount...`);
    const amount = Number(
      delivery.deliveryFee || delivery.totalFare || delivery.riderFee
    );

    if (!amount || isNaN(amount) || amount <= 0) {
      console.error(`❌ [PAYSTACK INIT] Failed: Invalid amount calculated -> ${amount}`);
      return res.status(400).json({
        success: false,
        message: `Invalid delivery fee amount: ${amount}`,
      });
    }

    // 5. VALIDATE VENDOR EMAIL
    const customerEmail = vendor.user?.email?.trim();
    if (!customerEmail) {
      console.error("❌ [PAYSTACK INIT] Failed: Vendor user account has no valid email address.");
      return res.status(400).json({
        success: false,
        message: "Vendor email address is missing. Cannot initialize payment.",
      });
    }

    // 6. VALIDATE PAYSTACK SECRET KEY
    if (!PAYSTACK_SECRET_KEY) {
      console.error("❌ [PAYSTACK INIT] Fatal: PAYSTACK_SECRET_KEY is missing in your .env file!");
      return res.status(500).json({
        success: false,
        message: "Server configuration error: Paystack secret key is not configured.",
      });
    }

    if (!PAYSTACK_SECRET_KEY.startsWith("sk_test_") && !PAYSTACK_SECRET_KEY.startsWith("sk_live_")) {
      console.warn("⚠️ [PAYSTACK INIT] Warning: PAYSTACK_SECRET_KEY does not start with sk_test_ or sk_live_. Check if you pasted a public key by mistake!");
    }

    // 7. PREPARE PAYSTACK PAYLOAD
    const reference = `CXR-${delivery.id}-${Date.now()}`;
    const amountInKobo = Math.round(amount * 100);
    const callbackUrl = `${ "http://localhost:5173"}/payment/callback`;

    const paystackPayload = {
      email: customerEmail,
      amount: amountInKobo,
      reference,
      currency: "NGN",
      callback_url: callbackUrl,
      metadata: {
        deliveryId: delivery.id,
        recipientName: delivery.recipientName,
        recipientPhone: delivery.recipientPhone,
      },
    };

    console.log(`📤 [PAYSTACK INIT] Step 6: Dispatching request to Paystack API...`);
    console.log("📦 [PAYSTACK INIT] Payload:", JSON.stringify(paystackPayload, null, 2));

    // 8. CALL PAYSTACK API
    const paystackResponse = await axios.post(
      `${PAYSTACK_BASE_URL}/transaction/initialize`,
      paystackPayload,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const paystackResult = paystackResponse.data;
    console.log("📥 [PAYSTACK INIT] Paystack Raw Response:", JSON.stringify(paystackResult, null, 2));

    if (!paystackResult?.status || !paystackResult?.data?.authorization_url) {
      console.error("❌ [PAYSTACK INIT] Failed: Paystack responded without an authorization URL.");
      return res.status(400).json({
        success: false,
        message:
          paystackResult?.message ||
          "Payment initialization failed. No payment URL was returned by Paystack.",
      });
    }

    const paystackData = paystackResult.data;

    // 9. CREATE PAYMENT RECORD
    console.log(`💾 [PAYSTACK INIT] Step 7: Saving payment record to database (Ref: ${paystackData.reference})...`);
    const payment = await prisma.payment.create({
      data: {
        amount,
        currency: "NGN",
        status: "PENDING",
        method: "PAYSTACK",
        reference: paystackData.reference,
        authorizationUrl: paystackData.authorization_url,
        delivery: {
          connect: { id: delivery.id },
        },
        vendor: {
          connect: { id: vendor.id },
        },
        metadata: {
          access_code: paystackData.access_code,
          paystack_reference: paystackData.reference,
          paystack_response: paystackResult,
          deliveryId: delivery.id,
        },
      },
    });

    console.log(`✅ [PAYSTACK INIT] SUCCESS! Payment created (ID: ${payment.id}). Sending URL to frontend.`);
    console.log(`==================================================\n`);

    // 10. RETURN PAYMENT URL
    return res.status(200).json({
      success: true,
      message: "Payment initialized successfully",
      payment: {
        id: payment.id,
        reference: payment.reference,
        authorizationUrl: payment.authorizationUrl,
        accessCode: paystackData.access_code,
      },
    });
  } catch (error) {
    console.log(`\n❌ ==================================================`);
    console.error("🚨 [PAYSTACK INIT ERROR] Exception caught during initialization:");

    if (error.response) {
      console.error(`Status Code: ${error.response.status}`);
      console.error("Paystack Error Data:", JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error("No response received from Paystack API:", error.message);
    } else {
      console.error("Request Setup Error:", error.message);
    }
    console.log(`==================================================\n`);

    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        error.message ||
        "Failed to initiate payment due to a server error.",
      paystackError: error.response?.data || null,
    });
  }
};

// =====================================================
// VERIFY DELIVERY PAYMENT
// =====================================================

export const verifyDeliveryPayment = async (req, res) => {
  try {
    // ✅ Safe extraction matching your other controllers
    const userId = req.user?.userId || req.user?.id;
    const { reference } = req.params;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Authentication error: User ID missing." });
    }

    if (!reference) {
      return res.status(400).json({ success: false, message: "Payment reference is required" });
    }

    const cleanReference = reference.trim();

    const payment = await prisma.payment.findUnique({
      where: { reference: cleanReference },
      include: {
        delivery: {
          include: {
            vendor: true,
            rider: true,
          },
        },
      },
    });

    if (!payment) {
      return res.status(404).json({ success: false, message: "Payment record not found" });
    }

    if (payment.status === "SUCCESS") {
      return res.status(200).json({ 
        success: true, 
        message: "Payment already verified", 
        paymentStatus: "SUCCESS", 
        payment 
      });
    }

    // Verify with Paystack
    const paystackResponse = await axios.get(
      `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(cleanReference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );

    const paystackResult = paystackResponse.data;
    const paymentData = paystackResult?.data;

    if (!paystackResult?.status || !paymentData || paymentData.status !== "success") {
      return res.status(400).json({ success: false, message: "Payment verification failed" });
    }

    const expectedAmountInKobo = Math.round(Number(payment.amount) * 100);
    if (Number(paymentData.amount) !== expectedAmountInKobo) {
      return res.status(400).json({ success: false, message: "Payment amount does not match delivery fee" });
    }

    // Execute Transaction: Update Payment & Delivery Status, Clear Notifications, Notify Rider
    const result = await prisma.$transaction(async (tx) => {
      // 1. Update Payment Status to SUCCESS
      const updatedPayment = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: "SUCCESS",
          gatewayTransactionId: paymentData.id?.toString(),
          paidAt: paymentData.paid_at ? new Date(paymentData.paid_at) : new Date(),
          metadata: paymentData,
        },
      });

      // 1.5 Update Delivery status so rider's active delivery unlocks
      const updatedDelivery = await tx.delivery.update({
        where: { id: payment.deliveryId },
        data: { status: "PAID" }, // Change to match your status flow (e.g., ASSIGNED or PAID)
      });

      // 2. Clear vendor payment notification
      const trackingId = payment.delivery?.trackingId;
      const deleteConditions = [];
      if (trackingId) deleteConditions.push({ message: { contains: trackingId } });
      if (cleanReference) deleteConditions.push({ message: { contains: cleanReference } });

      if (deleteConditions.length > 0) {
        await tx.notification.deleteMany({
          where: {
            userId: userId,
            OR: deleteConditions,
          },
        });
      }

      // 3. Notify Rider In-App
      if (payment.delivery?.rider?.userId) {
        await tx.notification.create({
          data: {
            userId: payment.delivery.rider.userId,
            title: "Payment Confirmed 🚀",
            message: "The vendor has completed payment. You can now proceed to pick up the package.",
            type: "DELIVERY_PAID",
          },
        });
      }

      return { updatedPayment, updatedDelivery };
    });

    // ─────────────────────────────────────────────
    // SEND WHATSAPP NOTIFICATION TO RECIPIENT (Safeguarded)
    // ─────────────────────────────────────────────
    const delivery = payment.delivery;
    if (delivery && delivery.recipientPhone && delivery.trackingId) {
      const siteUrl = process.env.FRONTEND_URL || "https://courierx.vercel.app";
      const trackingLink = `${siteUrl}/track/${delivery.trackingId}`;

      const whatsappMessage = 
        `Hello ${delivery.recipientName || "Customer"}! 👋\n\n` +
        `Your payment for CourierX delivery (${delivery.trackingId}) was successful! 🎉\n\n` +
        `You can track your package in real-time here:\n${trackingLink}\n\n` +
        `Thank you for using CourierX! 🚚`;

      // Make sure sendWhatsAppMessage is imported at the top of your file, 
      // or wrapped safely to prevent crashes if undefined:
      if (typeof sendWhatsAppMessage === "function") {
        sendWhatsAppMessage(delivery.recipientPhone, whatsappMessage).catch((err) => {
          console.error("Failed to send recipient WhatsApp notification:", err);
        });
      } else {
        console.warn("sendWhatsAppMessage function is not defined or imported.");
      }
    }

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      paymentStatus: "SUCCESS",
      payment: result.updatedPayment,
    });
  } catch (error) {
    console.error("🚨 [PAYSTACK VERIFY ERROR]:", error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Failed to verify payment due to a server error.",
    });
  }
};

// =====================================================
// HANDLE PAYSTACK WEBHOOK + WHATSAPP NOTIFICATION
// =====================================================

export const handlePaystackWebhook = async (req, res) => {
  try {
    // 1. Verify Paystack Webhook Signature for absolute security
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY)
                       .update(JSON.stringify(req.body))
                       .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      console.warn("⚠️ [WEBHOOK] Unauthorized webhook attempt: Invalid signature.");
      return res.status(400).send('Invalid signature');
    }

    const event = req.body;
    console.log(`🔔 [WEBHOOK RECEIVED] Event type: ${event.event}`);

    // 2. Listen for successful charge events
    if (event.event === 'charge.success') {
      const paystackData = event.data;
      const metadata = paystackData.metadata || {};
      const { deliveryId } = metadata; 

      if (!deliveryId) {
        console.warn("⚠️ [WEBHOOK] charge.success received, but deliveryId was missing from metadata.");
        return res.status(200).json({ received: true });
      }

      // 3. Update Payment record status to SUCCESS
      await prisma.payment.update({
        where: { reference: paystackData.reference },
        data: { 
          status: "SUCCESS", 
          paidAt: paystackData.paid_at ? new Date(paystackData.paid_at) : new Date(),
          gatewayTransactionId: String(paystackData.id)
        }
      });

      // 4. Update Delivery status to ASSIGNED so the rider can proceed
      const delivery = await prisma.delivery.update({
        where: { id: deliveryId },
        data: {
          status: "ASSIGNED"
        }
      });

      console.log(`✅ [DB UPDATED] Delivery ${delivery.trackingId} marked as ASSIGNED & Payment marked SUCCESS via Webhook.`);

      // 5. Build WhatsApp text payload
      const trackingLink = `${process.env.FRONTEND_URL || 'https://yourwebsite.com'}/track/${delivery.trackingId}`;
      const whatsappNumber = delivery.recipientPhone; // Must be formatted with country code (e.g. 2348012345678)

      const whatsappMessage = `Hello ${delivery.recipientName}, your package payment is confirmed! 📦\n\nTrack your package live here: ${trackingLink}\n\nYour Delivery PIN is: *${delivery.deliveryPin}*\n\n*(Give this PIN to the rider only when they arrive with your package)*`;

      // 6. Dispatch message via WhatsApp Cloud API
      try {
        await axios.post(
          `https://graph.facebook.com/v17.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: whatsappNumber,
            type: "text",
            text: { body: whatsappMessage }
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
              "Content-Type": "application/json"
            }
          }
        );
        console.log(`✅ [WHATSAPP SENT] Package info dispatched to recipient: ${whatsappNumber}`);
      } catch (waError) {
        console.error("❌ [WHATSAPP API ERROR]:", waError.response?.data || waError.message);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("❌ [WEBHOOK CRITICAL ERROR]:", error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
};