import axios from "axios";
import prisma from "../prismaClient.js";




export const receiveWhatsAppMessage = async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(404);
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value;

        // Incoming WhatsApp messages
        for (const message of value.messages || []) {
          const sender = message.from;
          const messageId = message.id;
          const messageType = message.type;

          let messageText = "";

          if (message.type === "text") {
            messageText = message.text?.body || "";
          }

          console.log("📱 WhatsApp message received");
          console.log("From:", sender);
          console.log("Message ID:", messageId);
          console.log("Type:", messageType);
          console.log("Message:", messageText);

          // 1. Find or create the conversation for this sender phone number
          const conversation = await prisma.whatsAppConversation.upsert({
            where: { phoneNumber: sender },
            update: { lastMessageAt: new Date() },
            create: {
              phoneNumber: sender,
              lastMessageAt: new Date(),
            },
          });

          // 2. Save the incoming message linked to the conversation
          await prisma.whatsAppMessage.create({
            data: {
              whatsappMessageId: messageId,
              conversationId: conversation.id,
              direction: "INCOMING",
              messageType: messageType,
              message: messageText,
              status: "RECEIVED",
              whatsappTimestamp: message.timestamp ? new Date(Number(message.timestamp) * 1000) : new Date(),
              metadata: message,
            },
          });
        }
      }
    }

    return res.sendStatus(200);

  } catch (error) {
    console.error("WhatsApp controller error:", error);
    return res.sendStatus(200);
  }
};

/**
 * Send an outbound text message via WhatsApp Cloud API & save to DB
 */
export const sendWhatsAppMessage = async (recipientPhone, messageText, deliveryId = null) => {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !accessToken) {
      throw new Error("WhatsApp API credentials missing in environment variables.");
    }

    // 1. Make HTTP request to Meta Graph API
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: recipientPhone,
        type: "text",
        text: { body: messageText },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const metaResponseData = response.data;
    const sentMessageId = metaResponseData.messages?.[0]?.id;

    // 2. Find or create conversation
    let conversation = await prisma.whatsAppConversation.findUnique({
      where: { phoneNumber: recipientPhone },
    });

    if (!conversation) {
      conversation = await prisma.whatsAppConversation.create({
        data: {
          phoneNumber: recipientPhone,
          deliveryId: deliveryId,
          lastMessageAt: new Date(),
        },
      });
    } else if (deliveryId && !conversation.deliveryId) {
      // Update delivery link if it wasn't set before
      await prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: { deliveryId },
      });
    }

    // 3. Save outgoing message to database
    await prisma.whatsAppMessage.create({
      data: {
        whatsappMessageId: sentMessageId || `outbound_${Date.now()}`,
        conversationId: conversation.id,
        direction: "OUTGOING",
        messageType: "text",
        message: messageText,
        status: "SENT",
        whatsappTimestamp: new Date(),
        metadata: metaResponseData,
      },
    });

    console.log(`📤 Outbound WhatsApp message sent to ${recipientPhone}`);
    return { success: true, messageId: sentMessageId };

  } catch (error) {
    console.error("Error sending WhatsApp message:", error.response?.data || error.message);
    throw error;
  }
};
/**
 * Update message delivery status from Meta webhook status payloads
 */
export const updateWhatsAppStatus = async (statusData) => {
  try {
    const messageId = statusData.id;
    const updateStatus = statusData.status.toUpperCase();

    console.log(`📨 Status Update for ${messageId}: ${updateStatus}`);

    let prismaStatus = "RECEIVED";
    if (updateStatus === "SENT") prismaStatus = "SENT";
    if (updateStatus === "DELIVERED") prismaStatus = "DELIVERED";
    if (updateStatus === "READ") prismaStatus = "READ";
    if (updateStatus === "FAILED") prismaStatus = "FAILED";

    await prisma.whatsAppMessage.update({
      where: { whatsappMessageId: messageId },
      data: { status: prismaStatus },
    });
  } catch (dbError) {
    console.log(`Note: Outbound message ${statusData.id} not found in local DB for status update.`);
  }
};