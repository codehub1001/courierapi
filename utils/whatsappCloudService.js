import axios from "axios";

/**
 * =========================================================
 * FORMAT NIGERIAN PHONE NUMBER
 * =========================================================
 */
const formatNigerianPhone = (phone) => {
  if (!phone) {
    throw new Error("Recipient phone number is required");
  }

  let formatted = String(phone).trim();

  // Remove spaces, brackets, dashes, etc.
  formatted = formatted.replace(/[^\d+]/g, "");

  // +2348012345678 -> 2348012345678
  if (formatted.startsWith("+")) {
    formatted = formatted.slice(1);
  }

  // 08012345678 -> 2348012345678
  if (formatted.startsWith("0")) {
    formatted = "234" + formatted.slice(1);
  }

  // Basic Nigerian number validation
  if (!/^234\d{10}$/.test(formatted)) {
    throw new Error(
      `Invalid Nigerian WhatsApp number: ${formatted}`
    );
  }

  return formatted;
};


/**
 * =========================================================
 * SEND WHATSAPP TEMPLATE MESSAGE
 * =========================================================
 */
export const sendWhatsAppMessage = async (
  recipientPhone,
  templateName,
  paramsArray = [],
  languageCode = "en"
) => {
  try {
    // ---------------------------------------------
    // Validate template
    // ---------------------------------------------
    if (!templateName) {
      throw new Error("WhatsApp template name is required");
    }

    // ---------------------------------------------
    // Format phone number
    // ---------------------------------------------
    const formattedPhone = formatNigerianPhone(recipientPhone);

    // ---------------------------------------------
    // Get environment variables
    // ---------------------------------------------
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId) {
      throw new Error(
        "WHATSAPP_PHONE_NUMBER_ID is missing from environment variables"
      );
    }

    if (!accessToken) {
      throw new Error(
        "WHATSAPP_TOKEN is missing from environment variables"
      );
    }

    // ---------------------------------------------
    // Format template parameters
    // ---------------------------------------------
    const formattedParams = Array.isArray(paramsArray)
      ? paramsArray.map((value) => ({
          type: "text",
          text: String(value ?? ""),
        }))
      : [];

    // ---------------------------------------------
    // Build Meta request
    // ---------------------------------------------
    const requestBody = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formattedPhone,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
      },
    };

    // Only add components if parameters exist
    if (formattedParams.length > 0) {
      requestBody.template.components = [
        {
          type: "body",
          parameters: formattedParams,
        },
      ];
    }

    // ---------------------------------------------
    // Log request
    // ---------------------------------------------
    console.log("\n======================================");
    console.log("📱 COURIERX WHATSAPP");
    console.log("======================================");
    console.log("Recipient:", formattedPhone);
    console.log("Template:", templateName);
    console.log("Language:", languageCode);
    console.log("Parameters:", paramsArray);
    console.log("======================================");

    // ---------------------------------------------
    // Send to Meta
    // ---------------------------------------------
    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
      requestBody,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    // ---------------------------------------------
    // Extract Meta response
    // ---------------------------------------------
    const data = response.data;

    const messageId =
      data?.messages?.[0]?.id || null;

    const waId =
      data?.contacts?.[0]?.wa_id || formattedPhone;

    // ---------------------------------------------
    // IMPORTANT:
    // This means Meta ACCEPTED the message.
    // It does NOT necessarily mean DELIVERED.
    // ---------------------------------------------
    console.log("\n======================================");
    console.log("✅ WHATSAPP MESSAGE ACCEPTED BY META");
    console.log("======================================");
    console.log("Recipient:", formattedPhone);
    console.log("WhatsApp ID:", waId);
    console.log("Message ID:", messageId);
    console.log("Template:", templateName);
    console.log("Status:", "ACCEPTED");
    console.log("======================================\n");

    return {
      success: true,
      accepted: true,
      delivered: false,
      recipient: formattedPhone,
      waId,
      messageId,
      templateName,
      response: data,
    };

  } catch (error) {
    // ---------------------------------------------
    // Get Meta error
    // ---------------------------------------------
    const metaError = error.response?.data;

    console.error("\n======================================");
    console.error("❌ WHATSAPP MESSAGE FAILED");
    console.error("======================================");
    console.error("Recipient:", recipientPhone);
    console.error("Template:", templateName);

    if (metaError) {
      console.error(
        "Meta Error:",
        JSON.stringify(metaError, null, 2)
      );
    } else {
      console.error("Error:", error.message);
    }

    console.error("======================================\n");

    return {
      success: false,
      accepted: false,
      delivered: false,
      recipient: recipientPhone,
      templateName,
      error: metaError || error.message,
    };
  }
};


/**
 * =========================================================
 * REGISTER WHATSAPP PHONE NUMBER
 *
 * Run this ONCE when setting up the WhatsApp phone number.
 * Do NOT call this every time you send a message.
 * =========================================================
 */
export const registerWhatsAppNumber = async () => {
  try {
    const phoneNumberId =
      process.env.WHATSAPP_PHONE_NUMBER_ID;

    const accessToken =
      process.env.WHATSAPP_TOKEN;

    const pin =
      process.env.WHATSAPP_PIN;

    if (!phoneNumberId) {
      throw new Error(
        "WHATSAPP_PHONE_NUMBER_ID is missing"
      );
    }

    if (!accessToken) {
      throw new Error(
        "WHATSAPP_TOKEN is missing"
      );
    }

    if (!pin) {
      throw new Error(
        "WHATSAPP_PIN is missing"
      );
    }

    const response = await axios.post(
      `https://graph.facebook.com/v23.0/${phoneNumberId}/register`,
      {
        messaging_product: "whatsapp",
        pin: String(pin),
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    console.log(
      "✅ WhatsApp phone number registered:",
      response.data
    );

    return {
      success: true,
      data: response.data,
    };

  } catch (error) {
    console.error(
      "❌ WhatsApp registration failed:",
      JSON.stringify(
        error.response?.data || error.message,
        null,
        2
      )
    );

    return {
      success: false,
      error:
        error.response?.data ||
        error.message,
    };
  }
};

