import axios from "axios";

export const sendWhatsAppTemplateMessage = async (recipientPhone, templateParams) => {
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
      console.warn("WhatsApp credentials missing. Message skipped.");
      return;
    }

    const response = await axios.post(
      `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, // Updated to a stable version
      {
        messaging_product: "whatsapp",
        to: formattedPhone,
        type: "template",
        template: {
          name: "payment_success", // Must match your approved template name in Meta
          language: {
            code: "en", // Or your target language code
          },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: templateParams.recipientName },
                { type: "text", text: templateParams.trackingId },
                { type: "text", text: templateParams.trackingLink },
              ],
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

    console.log("WhatsApp template message sent successfully:", response.data);
    return response.data;
  } catch (error) {
    console.error(
      "Failed to send WhatsApp message:",
      error.response?.data || error.message
    );
  }
};