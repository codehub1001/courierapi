import prisma from "../prismaClient.js";

// 1. Get all notifications for the logged-in user
export const getNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // 1. Fetch all notifications for the user
    let notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 30,
    });

    // 2. Collect delivery IDs associated with these notifications
    const deliveryIds = notifications
      .map((n) => n.deliveryId || n.metadata?.deliveryId)
      .filter(Boolean);

    if (deliveryIds.length > 0) {
      // 3. Fetch payment statuses for these deliveries
      const payments = await prisma.payment.findMany({
        where: { deliveryId: { in: deliveryIds } },
        select: { deliveryId: true, status: true },
      });

      const paymentMap = {};
      payments.forEach((p) => {
        paymentMap[p.deliveryId] = p.status; // e.g. "SUCCESS"
      });

      // 4. Inject payment status into the notification objects WITHOUT deleting them
      notifications = notifications.map((n) => {
        const dId = n.deliveryId || n.metadata?.deliveryId;
        const payStatus = dId ? paymentMap[dId] : null;
        const isSuccess = payStatus === "SUCCESS";

        return {
          ...n,
          paymentStatus: payStatus || n.paymentStatus,
          isPaid: isSuccess || n.isPaid,
          metadata: {
            ...(n.metadata || {}),
            paymentStatus: payStatus || n.metadata?.paymentStatus,
            isPaid: isSuccess || n.metadata?.isPaid,
          },
        };
      });
    }

    const unreadCount = notifications.filter((n) => !n.isRead).length;

    return res.status(200).json({
      success: true,
      unreadCount,
      data: notifications,
    });
  } catch (error) {
    console.error("GET NOTIFICATIONS ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch notifications." });
  }
};

// 2. Mark a single notification as read
export const markAsRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification || notification.userId !== userId) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error("MARK AS READ ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to update notification." });
  }
};

// 3. Mark all notifications as read
export const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    return res.status(200).json({ success: true, message: "All notifications marked as read." });
  } catch (error) {
    console.error("MARK ALL AS READ ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to update notifications." });
  }
};

// 4. Delete a notification
export const deleteNotification = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { id } = req.params;

    const notification = await prisma.notification.findUnique({ where: { id } });

    if (!notification || notification.userId !== userId) {
      return res.status(404).json({ success: false, message: "Notification not found." });
    }

    await prisma.notification.delete({ where: { id } });

    return res.status(200).json({ success: true, message: "Notification deleted." });
  } catch (error) {
    console.error("DELETE NOTIFICATION ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to delete notification." });
  }
};

// Helper function to trigger notifications anywhere in your backend
export const createNotification = async ({ userId, title, message, type = "GENERAL" }) => {
  try {
    return await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        type,
      },
    });
  } catch (error) {
    console.error("CREATE NOTIFICATION HELPER ERROR:", error);
  }
};