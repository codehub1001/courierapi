import axios from "axios";

export const sendWhatsAppMessage = async (recipientPhone, templateName, paramsArray = []) => {
  try {
    let formattedPhone = recipientPhone.toString().trim();
    if (formattedPhone.startsWith("0")) {
      formattedPhone = "234" + formattedPhone.slice(1);
    } else if (formattedPhone.startsWith("+")) {
      formattedPhone = formattedPhone.slice(1);
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !accessToken) {
      console.warn("⚠️ WhatsApp credentials missing. Message skipped.");
      return;
    }

    // Map parameters into Meta Cloud API expected format
    const formattedParams = paramsArray.map((text) => ({
      type: "text",
      text: String(text),
    }));

    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: [
            {
              type: "body",
              parameters: formattedParams,
            },
          ],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log(`✅ WhatsApp [${templateName}] sent successfully to ${formattedPhone}`);
    return response.data;
  } catch (error) {
    console.error(
      "❌ Failed to send WhatsApp message:",
      error.response?.data || error.message
    );
  }
};
export const registerWhatsAppNumber = async () => {
  try {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_TOKEN;

    if (!phoneNumberId || !accessToken) {
      console.log("⚠️ Credentials missing");
      return;
    }

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/register`,
      {
        messaging_product: "whatsapp",
        pin: "123456" // Your 6-digit PIN for two-step verification
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    console.log("✅ Registration successful:", response.data);
  } catch (error) {
    console.error("❌ Registration failed:", error.response?.data || error.message);
  }
};