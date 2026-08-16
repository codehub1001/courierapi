import prisma from "../prismaClient.js";

/**
 * Send a notification to a specific user (Vendor or Rider user ID)
 */
export const sendNotification = async ({ userId, title, message, type = "GENERAL" }) => {
  try {
    if (!userId) return;
    await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
      },
    });
  } catch (error) {
    console.error("NOTIFICATION HELPER ERROR:", error);
  }
};