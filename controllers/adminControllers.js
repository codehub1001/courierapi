import prisma from "../prismaClient.js";

// Helper to handle both integer IDs (1, 2, 3) and string UUIDs ("cju...")
const parseId = (id) => (isNaN(Number(id)) ? id : Number(id));

// ─────────────────────────────────────────────
// 1. TOGGLE OR REVOKE RIDER VERIFICATION
// ─────────────────────────────────────────────
export const toggleRiderVerification = async (req, res) => {
  try {
    const { id } = req.params;
    const { isVerified } = req.body;
    const targetId = parseId(id);

    // Fetch existing rider profile
    const existingRider = await prisma.riderProfile.findUnique({
      where: { id: targetId },
    });

    if (!existingRider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found.",
      });
    }

    // Determine new verification state
    const newVerificationStatus =
      typeof isVerified === "boolean" ? isVerified : !existingRider.isVerified;

    // If newly verified and was PENDING_VERIFICATION, set status to IDLE
    let nextStatus = existingRider.status;
    if (newVerificationStatus && existingRider.status === "PENDING_VERIFICATION") {
      nextStatus = "IDLE";
    }

    // Perform database update
    const updatedRider = await prisma.riderProfile.update({
      where: { id: targetId },
      data: {
        isVerified: newVerificationStatus,
        status: nextStatus,
      },
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            wallet: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Rider verification ${newVerificationStatus ? "approved" : "revoked"} successfully.`,
      rider: updatedRider,
    });
  } catch (error) {
    console.error("Error toggling rider verification:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while updating verification status.",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// 2. CHANGE RIDER STATUS (SUSPEND / REACTIVATE / DUTY)
// ─────────────────────────────────────────────
export const updateRiderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;
    const targetId = parseId(id);

    const ALLOWED_STATUSES = ["ACTIVE", "IDLE", "PENDING_VERIFICATION", "SUSPENDED"];

    if (!status || !ALLOWED_STATUSES.includes(status.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid status provided. Allowed statuses: ${ALLOWED_STATUSES.join(", ")}`,
      });
    }

    const existingRider = await prisma.riderProfile.findUnique({
      where: { id: targetId },
    });

    if (!existingRider) {
      return res.status(404).json({
        success: false,
        message: "Rider not found.",
      });
    }

    const newStatus = status.toUpperCase();
    const previousStatus = existingRider.status;

    // Prepare admin notes if a suspension reason is provided
    let updateData = { status: newStatus };
    if (reason && newStatus === "SUSPENDED") {
      const currentNotes = Array.isArray(existingRider.adminNotes)
        ? existingRider.adminNotes
        : [];
      
      updateData.adminNotes = [
        ...currentNotes,
        {
          text: `Suspended by admin: ${reason}`,
          date: new Date().toISOString(),
        },
      ];
    }

    const updatedRider = await prisma.riderProfile.update({
      where: { id: targetId },
      data: updateData,
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            wallet: true,
          },
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: `Rider status updated from ${previousStatus} to ${updatedRider.status}.`,
      rider: updatedRider,
    });
  } catch (error) {
    console.error("Error updating rider status:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while updating rider status.",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// 3. GET ALL RIDERS (WITH ONLINE/OFFLINE FILTER)
// ─────────────────────────────────────────────
export const getAllRiders = async (req, res) => {
  try {
    const { status, isAvailable } = req.query;

    const where = {};

    if (status) {
      if (status.toLowerCase() === "online") {
        where.isAvailable = true;
      } else if (status.toLowerCase() === "offline") {
        where.isAvailable = false;
      }
    } else if (isAvailable !== undefined) {
      where.isAvailable = isAvailable === "true";
    }

    const riders = await prisma.riderProfile.findMany({
      where,

      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,

            wallet: {
              select: {
                balance: true,
                currency: true,
              },
            },
          },
        },

        deliveries: {
          orderBy: {
            createdAt: "desc",
          },

          select: {
            id: true,
            trackingId: true,
            recipientName: true,
            recipientPhone: true,
            recipientAddress: true,
            packageType: true,
            packageWeight: true,
            deliveryFee: true,
            riderFee: true,
            status: true,
            createdAt: true,
          },

          take: 5,
        },

        _count: {
          select: {
            deliveries: true,
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    const formatted = riders.map((rider) => {
      const deliveries = rider.deliveries;

      const completedDeliveries = deliveries.filter(
        (d) => d.status === "DELIVERED"
      ).length;

      const activeDeliveries = deliveries.filter((d) =>
        ["ASSIGNED", "PICKED_UP", "IN_TRANSIT"].includes(d.status)
      ).length;

      const cancelledDeliveries = deliveries.filter(
        (d) => d.status === "CANCELLED"
      ).length;

      const pendingDeliveries = deliveries.filter(
        (d) => d.status === "PENDING"
      ).length;

      const totalEarnings = deliveries.reduce(
        (sum, d) => sum + Number(d.riderFee || 0),
        0
      );

      const realCount = rider._count.deliveries;

      return {
        ...rider,

        walletBalance: rider.user.wallet?.balance || 0,

        totalDeliveries: realCount,

        actualDeliveries: realCount,

        completedDeliveries,

        activeDeliveries,

        pendingDeliveries,

        cancelledDeliveries,

        totalEarnings,

        recentDeliveries: deliveries,

        // Explicitly exposing bank details properties from RiderProfile model
        bankDetails: {
          bankName: rider.bankName || null,
          accountNumber: rider.accountNumber || null,
          accountName: rider.accountName || null,
        },
      };
    });

    return res.status(200).json({
      success: true,
      count: formatted.length,
      riders: formatted,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch riders",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// 4. GET ALL VENDORS
// ─────────────────────────────────────────────
export const getAllVendors = async (req, res) => {
  try {
    const vendors = await prisma.vendorProfile.findMany({
      include: {
        user: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            wallet: true,
          },
        },
        deliveries: {
          select: {
            id: true,
            trackingId: true,
            status: true,
            deliveryFee: true,
            riderFee: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const formattedVendors = vendors.map((vendor) => ({
      ...vendor,
      totalDeliveries: vendor.deliveries.length,
      completedDeliveries: vendor.deliveries.filter(
        (d) => d.status === "DELIVERED"
      ).length,
      activeDeliveries: vendor.deliveries.filter((d) =>
        ["PENDING", "ASSIGNED", "PENDING_PAYMENT", "PAID", "PICKUP", "IN_TRANSIT"].includes(d.status)
      ).length,
      cancelledDeliveries: vendor.deliveries.filter(
        (d) => d.status === "CANCELLED"
      ).length,
    }));

    return res.status(200).json({
      success: true,
      count: formattedVendors.length,
      vendors: formattedVendors,
    });
  } catch (error) {
    console.error("Get all vendors error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch vendors",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// 5. GET ALL DELIVERIES
// ─────────────────────────────────────────────
export const getAllDeliveries = async (req, res) => {
  try {
    const deliveries = await prisma.delivery.findMany({
      include: {
        vendor: {
          select: {
            businessName: true,
            businessAddress: true,
            user: {
              select: {
                fullName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
        rider: {
          include: {
            user: {
              select: {
                fullName: true,
                phone: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      count: deliveries.length,
      deliveries,
    });
  } catch (error) {
    console.error("Get all deliveries error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch deliveries",
      error: error.message,
    });
  }
};
// ─────────────────────────────────────────────
// 6. GET ADMIN OVERVIEW / DASHBOARD STATS
// ─────────────────────────────────────────────
export const getAdminOverview = async (req, res) => {
  try {
    const [
      totalRevenueAggregate,
      completedDeliveriesCount,
      totalDeliveriesCount,
      activeDeliveriesCount,
      totalVendorsCount,
      totalRidersCount,
      activeRidersCount,
      recentDeliveries,
      recentRiders,
    ] = await Promise.all([
      // 1. Calculate Total Revenue from DELIVERED orders using deliveryFee
      prisma.delivery.aggregate({
        _sum: {
          deliveryFee: true,
        },
        where: {
          status: "DELIVERED",
        },
      }),

      // 2. Count Completed Deliveries
      prisma.delivery.count({
        where: { status: "DELIVERED" },
      }),

      // 3. Count Total Deliveries
      prisma.delivery.count(),

      // 4. Count Active Deliveries (In progress)
      prisma.delivery.count({
        where: {
          status: {
            in: ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT"],
          },
        },
      }),

      // 5. Count Total Vendors
      prisma.vendorProfile.count(),

      // 6. Count Total Riders
      prisma.riderProfile.count(),

      // 7. Count On-Duty/Available Riders
      prisma.riderProfile.count({
        where: { isAvailable: true },
      }),

      // 8. Fetch Recent Deliveries with Vendor & Rider relations
      prisma.delivery.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          trackingId: true,
          deliveryFee: true,
          riderFee: true,
          status: true,
          createdAt: true,
          vendor: {
            select: {
              businessName: true,
            },
          },
          rider: {
            select: {
              user: {
                select: {
                  fullName: true,
                },
              },
            },
          },
        },
      }),

      // 9. Fetch Recent Rider Registrations
      prisma.riderProfile.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          isVerified: true,
          vehicleNumber: true,
          createdAt: true,
          user: {
            select: {
              fullName: true,
              email: true,
              phone: true,
            },
          },
        },
      }),
    ]);

    // Calculate Completion Rate percentage
    const completionRate = totalDeliveriesCount
      ? Math.round((completedDeliveriesCount / totalDeliveriesCount) * 100)
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalRevenue: totalRevenueAggregate._sum.deliveryFee || 0,
          completedDeliveries: completedDeliveriesCount,
          totalDeliveries: totalDeliveriesCount,
          activeDeliveries: activeDeliveriesCount,
          totalVendors: totalVendorsCount,
          totalRiders: totalRidersCount,
          activeRiders: activeRidersCount,
          completionRate,
        },
        recentActivity: {
          deliveries: recentDeliveries,
          newRiders: recentRiders,
        },
      },
    });
  } catch (error) {
    console.error("Get admin overview error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error fetching dashboard statistics.",
      error: error.message,
    });
  }
};
export const getPaymentAnalytics = async (req, res) => {
  try {
    const today = new Date();
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(today.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const leaderboardPeriod = req.query.leaderboardPeriod || "monthly";
    const sortMetric = req.query.vendorSort || "revenue";

    let leaderboardStartDate = new Date();
    if (leaderboardPeriod === "weekly") {
      leaderboardStartDate.setDate(today.getDate() - 7);
    } else if (leaderboardPeriod === "monthly") {
      leaderboardStartDate.setMonth(today.getMonth() - 1);
    } else {
      leaderboardStartDate = new Date(0); // All-time
    }
    leaderboardStartDate.setHours(0, 0, 0, 0);

    const [
      completedFinancials,
      completedOrdersCount,
      pendingFinancials,
      recentDeliveries,
      rawVendorStats,
      rawRiderStats,
    ] = await Promise.all([
      prisma.delivery.aggregate({
        _sum: { deliveryFee: true, riderFee: true },
        _avg: { deliveryFee: true },
        where: { status: "DELIVERED" },
      }),

      prisma.delivery.count({
        where: { status: "DELIVERED" },
      }),

      prisma.delivery.aggregate({
        _sum: { deliveryFee: true, riderFee: true },
        where: {
          status: { in: ["PENDING", "ASSIGNED", "PICKED_UP", "IN_TRANSIT"] },
        },
      }),

      prisma.delivery.findMany({
        where: {
          status: "DELIVERED",
          createdAt: { gte: thirtyDaysAgo },
        },
        select: {
          deliveryFee: true,
          riderFee: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),

      prisma.delivery.groupBy({
        by: ["vendorId"],
        _sum: { deliveryFee: true },
        _count: { id: true },
        where: { 
          status: "DELIVERED",
          createdAt: { gte: leaderboardStartDate }
        },
      }),

      prisma.delivery.groupBy({
        by: ["riderId"],
        _sum: { riderFee: true },
        _count: { id: true },
        where: { 
          status: "DELIVERED",
          createdAt: { gte: leaderboardStartDate }
        },
        orderBy: { _sum: { riderFee: "desc" } },
        take: 10,
      }),
    ]);

    const totalRevenue = completedFinancials?._sum?.deliveryFee || 0;
    const totalRiderPayouts = completedFinancials?._sum?.riderFee || 0;
    const grossProfit = totalRevenue - totalRiderPayouts;
    const profitMargin = totalRevenue > 0 ? ((grossProfit / totalRevenue) * 100).toFixed(2) : 0;
    
    const pendingRevenue = pendingFinancials?._sum?.deliveryFee || 0;
    const pendingRiderPayouts = pendingFinancials?._sum?.riderFee || 0;

    const dailyChartMap = {};
    for (let i = 0; i <= 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const dateString = d.toISOString().split("T")[0];
      dailyChartMap[dateString] = { date: dateString, revenue: 0, riderPayouts: 0, profit: 0, count: 0 };
    }

    (recentDeliveries || []).forEach((delivery) => {
      if (!delivery?.createdAt) return;
      const dateString = delivery.createdAt.toISOString().split("T")[0];
      if (dailyChartMap[dateString]) {
        const rev = delivery.deliveryFee || 0;
        const payout = delivery.riderFee || 0;
        dailyChartMap[dateString].revenue += rev;
        dailyChartMap[dateString].riderPayouts += payout;
        dailyChartMap[dateString].profit += (rev - payout);
        dailyChartMap[dateString].count += 1;
      }
    });

    const chartData = Object.values(dailyChartMap).sort((a, b) => new Date(a.date) - new Date(b.date));

    const processedVendors = (rawVendorStats || [])
      .filter((v) => v && v.vendorId !== null)
      .map((stat) => {
        const totalRev = stat?._sum?.deliveryFee ? Number(stat._sum.deliveryFee) : 0;
        const orderCount = stat?._count?.id ? Number(stat._count.id) : 0;
        const aov = orderCount > 0 ? Math.round(totalRev / orderCount) : 0;

        let primaryMetricValue = totalRev;
        if (sortMetric === "volume") {
          primaryMetricValue = orderCount;
        } else if (sortMetric === "aov") {
          primaryMetricValue = aov;
        }

        return {
          vendorId: stat.vendorId,
          totalRev,
          orderCount,
          primaryMetricValue,
        };
      })
      .sort((a, b) => b.primaryMetricValue - a.primaryMetricValue)
      .slice(0, 5);

    const topVendorStats = processedVendors;
    const topRiderStats = (rawRiderStats || []).filter((r) => r && r.riderId !== null).slice(0, 5);

    const vendorIds = topVendorStats.map((v) => v.vendorId);
    const riderIds = topRiderStats.map((r) => r.riderId);

    const [vendorsDetails, ridersDetails] = await Promise.all([
      vendorIds.length > 0 ? prisma.vendorProfile.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, businessName: true },
      }) : [],
      riderIds.length > 0 ? prisma.riderProfile.findMany({
        where: { id: { in: riderIds } },
        select: { id: true, user: { select: { fullName: true } } },
      }) : []
    ]);

    const topVendors = topVendorStats.map((stat) => {
      const vendor = vendorsDetails.find((v) => v.id === stat.vendorId);
      return {
        vendorId: stat.vendorId,
        businessName: vendor?.businessName || "Unknown Vendor",
        primaryMetricValue: Number(stat.primaryMetricValue) || 0,
        orderCount: Number(stat.orderCount) || 0,
      };
    });

    const topRiders = topRiderStats.map((stat) => {
      const rider = ridersDetails.find((r) => r.id === stat.riderId);
      return {
        riderId: stat.riderId,
        riderName: rider?.user?.fullName || "Unknown Rider",
        totalEarnings: stat?._sum?.riderFee ? Number(stat._sum.riderFee) : 0,
        deliveriesCompleted: stat?._count?.id ? Number(stat._count.id) : 0,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        overview: {
          totalRevenue,
          totalRiderPayouts,
          grossProfit,
          profitMargin: parseFloat(profitMargin),
          averageDeliveryFee: Math.round(completedFinancials?._avg?.deliveryFee || 0),
        },
        pending: {
          totalPendingRevenue: pendingRevenue,
          totalPendingRiderPayouts: pendingRiderPayouts,
        },
        charts: {
          last30Days: chartData,
        },
        topPerformers: {
          topVendors,
          topRiders,
        },
        analyticsInsights: {
          totalCompletedOrders: completedOrdersCount || 0,
          escrowVelocity: "Real-time",
        }
      },
    });

  } catch (error) {
    console.error("Payment Analytics Error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while generating payment analytics.",
      error: error.message,
    });
  }
};
// ─────────────────────────────────────────────
// 7. ADMIN: GET ALL VENDORS DELIVERY HISTORY (COMPLETED & CANCELLED)
// ─────────────────────────────────────────────
export const adminGetAllVendorsDeliveryHistory = async (req, res) => {
  try {
    const deliveries = await prisma.delivery.findMany({
      where: {
        status: {
          in: ["DELIVERED", "CANCELLED"],
        },
      },
      include: {
        vendor: {
          select: {
            id: true,
            businessName: true,
            businessAddress: true,
            user: {
              select: {
                fullName: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        rider: {
          include: {
            user: {
              select: {
                fullName: true,
                phone: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const completedDeliveries = deliveries.filter((d) => d.status === "DELIVERED");
    const cancelledDeliveries = deliveries.filter((d) => d.status === "CANCELLED");

    return res.status(200).json({
      success: true,
      counts: {
        total: deliveries.length,
        completed: completedDeliveries.length,
        cancelled: cancelledDeliveries.length,
      },
      deliveries: {
        completed: completedDeliveries,
        cancelled: cancelledDeliveries,
        all: deliveries,
      },
    });
  } catch (error) {
    console.error("Error fetching all vendors delivery history:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching all vendors' delivery history.",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────
// 8. ADMIN: GET ALL VENDORS PAYMENT HISTORY
// ─────────────────────────────────────────────
export const adminGetAllVendorsPaymentHistory = async (req, res) => {
  try {
    const paymentRecords = await prisma.delivery.findMany({
      where: {
        status: {
          in: ["DELIVERED", "PAID"],
        },
      },
      select: {
        id: true,
        trackingId: true,
        deliveryFee: true,
        status: true,
        createdAt: true,
        recipientName: true,
        recipientAddress: true,
        packageType: true,
        vendor: {
          select: {
            id: true,
            businessName: true,
            user: {
              select: {
                fullName: true,
                email: true,
                wallet: {
                  select: {
                    balance: true,
                    currency: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const totalRevenue = paymentRecords.reduce(
      (sum, record) => sum + Number(record.deliveryFee || 0),
      0
    );

    return res.status(200).json({
      success: true,
      summary: {
        totalTransactions: paymentRecords.length,
        totalRevenue,
      },
      payments: paymentRecords,
    });
  } catch (error) {
    console.error("Error fetching all vendors payment history:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching all vendors' payment history.",
      error: error.message,
    });
  }
};
// ─────────────────────────────────────────────
// 9. ADMIN: GET ALL RIDERS PAYOUT & EARNINGS HISTORY
// ─────────────────────────────────────────────
export const adminGetAllRidersPayoutHistory = async (req, res) => {
  try {
    // Fetch all completed deliveries where riders earned their fees
    const payoutRecords = await prisma.delivery.findMany({
      where: {
        status: "DELIVERED",
        riderId: { not: null },
      },
      select: {
        id: true,
        trackingId: true,
        riderFee: true,
        status: true,
        createdAt: true,
        recipientName: true,
        rider: {
          select: {
            id: true,
            vehicleNumber: true,
            bankName: true,
            accountNumber: true,
            accountName: true,
            user: {
              select: {
                fullName: true,
                email: true,
                phone: true,
                wallet: {
                  select: {
                    balance: true,
                    currency: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Calculate total platform-wide rider payouts generated
    const totalRiderPayouts = payoutRecords.reduce(
      (sum, record) => sum + Number(record.riderFee || 0),
      0
    );

    return res.status(200).json({
      success: true,
      summary: {
        totalPayoutTransactions: payoutRecords.length,
        totalRiderPayouts,
      },
      payouts: payoutRecords,
    });
  } catch (error) {
    console.error("Error fetching all riders payout history:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching all riders' payout history.",
      error: error.message,
    });
  }
};