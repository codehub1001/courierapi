import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "../prismaClient.js";

const seed = async () => {
  try {
    console.log("🌱 Starting CourierX database seed...\n");

    const hashedPassword = await bcrypt.hash("Password123!", 10);
    const now = new Date();

    // =========================================
    // ADMIN
    // =========================================

    const admin = await prisma.user.upsert({
      where: {
        email: "admin@courierx.com",
      },
      update: {
        status: "ACTIVE",
      },
      create: {
        fullName: "CourierX Administrator",
        username: "admin",
        email: "admin@courierx.com",
        phone: "08000000000",
        password: hashedPassword,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    console.log(`✅ Admin created: ${admin.email}`);

    // =========================================
    // VENDORS
    // =========================================

    const vendorData = [
      {
        fullName: "Chukwuka Fashion",
        username: "chukwuka_fashion",
        email: "fashion@courierx.com",
        phone: "08100000001",
        businessName: "Chukwuka Fashion Store",
        businessType: "Fashion & Clothing",
        businessAddress: "12 Allen Avenue, Ikeja, Lagos",
        latitude: 6.6018,
        longitude: 3.3515,
      },
      {
        fullName: "Glow Beauty Store",
        username: "glow_beauty",
        email: "beauty@courierx.com",
        phone: "08100000002",
        businessName: "Glow Beauty Store",
        businessType: "Beauty & Cosmetics",
        businessAddress: "24 Admiralty Way, Lekki Phase 1, Lagos",
        latitude: 6.4474,
        longitude: 3.4722,
      },
      {
        fullName: "TechZone Nigeria",
        username: "techzone_ng",
        email: "techzone@courierx.com",
        phone: "08100000003",
        businessName: "TechZone Nigeria",
        businessType: "Electronics & Gadgets",
        businessAddress: "45 Computer Village, Ikeja, Lagos",
        latitude: 6.6013,
        longitude: 3.3421,
      },
      {
        fullName: "Home Essentials",
        username: "home_essentials",
        email: "home@courierx.com",
        phone: "08100000004",
        businessName: "Home Essentials NG",
        businessType: "Home & Lifestyle",
        businessAddress: "18 Herbert Macaulay Way, Yaba, Lagos",
        latitude: 6.5095,
        longitude: 3.3774,
      },
      {
        fullName: "Sneaker Plug",
        username: "sneaker_plug",
        email: "sneakers@courierx.com",
        phone: "08100000005",
        businessName: "Sneaker Plug Lagos",
        businessType: "Footwear",
        businessAddress: "8 Toyin Street, Ikeja, Lagos",
        latitude: 6.6011,
        longitude: 3.3512,
      },
      {
        fullName: "The Gift Hub",
        username: "the_gift_hub",
        email: "gifts@courierx.com",
        phone: "08100000006",
        businessName: "The Gift Hub",
        businessType: "Gifts & Accessories",
        businessAddress: "10 Awolowo Road, Ikoyi, Lagos",
        latitude: 6.4549,
        longitude: 3.4302,
      },
      {
        fullName: "Fresh Bites Lagos",
        username: "fresh_bites",
        email: "food@courierx.com",
        phone: "08100000007",
        businessName: "Fresh Bites Lagos",
        businessType: "Food & Restaurant",
        businessAddress: "32 Admiralty Road, Lekki, Lagos",
        latitude: 6.4479,
        longitude: 3.4781,
      },
      {
        fullName: "Urban Accessories",
        username: "urban_accessories",
        email: "accessories@courierx.com",
        phone: "08100000008",
        businessName: "Urban Accessories",
        businessType: "Fashion Accessories",
        businessAddress: "15 Bode Thomas Street, Surulere, Lagos",
        latitude: 6.5035,
        longitude: 3.3518,
      },
      {
        fullName: "Kids Corner NG",
        username: "kids_corner",
        email: "kids@courierx.com",
        phone: "08100000009",
        businessName: "Kids Corner Nigeria",
        businessType: "Children's Products",
        businessAddress: "22 Adeniran Ogunsanya Street, Surulere, Lagos",
        latitude: 6.4998,
        longitude: 3.3495,
      },
      {
        fullName: "Premium Market",
        username: "premium_market",
        email: "premium@courierx.com",
        phone: "08100000010",
        businessName: "Premium Market NG",
        businessType: "Online Retail",
        businessAddress:
          "5 Bishop Aboyade Cole Street, Victoria Island, Lagos",
        latitude: 6.4281,
        longitude: 3.4219,
      },
    ];

    const vendors = [];

    for (let i = 0; i < vendorData.length; i++) {
      const data = vendorData[i];
      const referralCode = `VEND-${String(i + 1).padStart(4, "0")}`;

      const vendor = await prisma.user.upsert({
        where: {
          email: data.email,
        },
        update: {
          status: "ACTIVE",
          vendorProfile: {
            update: {
              businessName: data.businessName,
              businessType: data.businessType,
              businessAddress: data.businessAddress,
              latitude: data.latitude,
              longitude: data.longitude,
            },
          },
        },
        create: {
          fullName: data.fullName,
          username: data.username,
          email: data.email,
          phone: data.phone,
          password: hashedPassword,
          role: "VENDOR",
          status: "ACTIVE",
          vendorProfile: {
            create: {
              businessName: data.businessName,
              businessType: data.businessType,
              businessAddress: data.businessAddress,
              latitude: data.latitude,
              longitude: data.longitude,
              referralCode,
            },
          },
        },
        include: {
          vendorProfile: true,
        },
      });

      vendors.push({
        ...vendor,
        latitude: data.latitude,
        longitude: data.longitude,
      });

      console.log(
        `✅ Vendor created: ${vendor.vendorProfile.businessName}`
      );
    }

    // =========================================
    // RIDERS
    // =========================================

    console.log("\n🏍️ Creating riders...\n");

    const riderAreas = [
      "Ikeja",
      "Lekki",
      "Ikeja",
      "Yaba",
      "Surulere",
      "Ikoyi",
      "Lekki",
      "Surulere",
      "Victoria Island",
      "Ikeja",
    ];

    const nigerianBanks = [
      "Guaranty Trust Bank",
      "Zenith Bank",
      "Access Bank",
      "United Bank for Africa",
      "First Bank of Nigeria",
      "Opay",
      "Moniepoint",
      "Kuda Bank",
      "Fidelity Bank",
      "Stanbic IBTC",
    ];

    const riders = [];

    for (let i = 1; i <= 10; i++) {
      const location = vendorData[i - 1];

      const fullName = `CourierX Rider ${i}`;
      const email = `rider${i}@courierx.com`;
      const username = `rider${i}`;
      const referralCode = `RIDE-${String(i).padStart(4, "0")}`;

      const vehicleNumber = `CXR-${String(i).padStart(3, "0")}-LA`;

      const currentLatitude = location.latitude + 0.001 * i;
      const currentLongitude = location.longitude + 0.001 * i;

      const rider = await prisma.user.upsert({
        where: {
          email,
        },
        update: {
          fullName,
          phone: `090000000${String(i).padStart(2, "0")}`,
          status: "ACTIVE",
          riderProfile: {
            update: {
              vehicleNumber,
              deliveryArea: riderAreas[i - 1],
              bankName: nigerianBanks[(i - 1) % nigerianBanks.length],
              accountNumber: `01234567${String(i).padStart(2, "0")}`,
              accountName: fullName,
              rating: Number(
                (4.5 + Math.random() * 0.5).toFixed(1)
              ),
              totalDeliveries: 20 + i * 5,
              isVerified: true,
              isAvailable: true,
              currentLatitude,
              currentLongitude,
              lastLocationUpdate: now,
              ninNumber: `123456789${i}`,
              bvnNumber: `223456789${i}`,
              passportUrl:
                "https://example.com/verification-document.jpg",
              verificationDocumentType: "NIN",
            },
          },
        },
        create: {
          fullName,
          username,
          email,
          phone: `090000000${String(i).padStart(2, "0")}`,
          password: hashedPassword,
          role: "RIDER",
          status: "ACTIVE",
          wallet: {
            create: {
              balance: 35000 + i * 2500,
              currency: "NGN",
            },
          },
          riderProfile: {
            create: {
              vehicleNumber,
              deliveryArea: riderAreas[i - 1],
              bankName: nigerianBanks[(i - 1) % nigerianBanks.length],
              accountNumber: `01234567${String(i).padStart(2, "0")}`,
              accountName: fullName,
              rating: Number(
                (4.5 + Math.random() * 0.5).toFixed(1)
              ),
              totalDeliveries: 20 + i * 5,
              isVerified: true,
              isAvailable: true,
              currentLatitude,
              currentLongitude,
              lastLocationUpdate: now,
              ninNumber: `123456789${i}`,
              bvnNumber: `223456789${i}`,
              passportUrl:
                "https://example.com/verification-document.jpg",
              verificationDocumentType: "NIN",
              referralCode,
            },
          },
        },
        include: {
          riderProfile: true,
          wallet: true,
        },
      });

      riders.push(rider);

      console.log(
        `🏍️ Rider created: ${rider.fullName} | ` +
          `Vehicle: ${rider.riderProfile.vehicleNumber} | ` +
          `Area: ${rider.riderProfile.deliveryArea}`
      );
    }

    // =========================================
    // DELIVERIES & PAYMENTS
    // =========================================

    console.log("\n📦 Creating deliveries and payment records...\n");

    const recipientLocations = [
      "Lekki Phase 1, Lagos",
      "Ikeja GRA, Lagos",
      "Yaba, Lagos",
      "Surulere, Lagos",
      "Victoria Island, Lagos",
      "Ikoyi, Lagos",
      "Maryland, Lagos",
      "Gbagada, Lagos",
      "Lagos Island, Lagos",
      "Ajah, Lagos",
    ];

    const packageTypes = [
      "Electronics",
      "Fashion Items",
      "Standard Package",
      "Documents",
      "Cosmetics",
    ];

    for (let i = 1; i <= 20; i++) {
      const vendor = vendors[(i - 1) % vendors.length];

      let status;
      let rider = null;

      if (i <= 5) {
        status = "PENDING";
      } else if (i === 6 || i === 7) {
        status = "ASSIGNED";
        rider = riders[(i - 1) % riders.length];
      } else if (i === 8 || i === 9) {
        status = "PICKED_UP";
        rider = riders[(i - 1) % riders.length];
      } else if (i === 10 || i === 11) {
        status = "IN_TRANSIT";
        rider = riders[(i - 1) % riders.length];
      } else if (i <= 17) {
        status = "DELIVERED";
        rider = riders[(i - 1) % riders.length];
      } else {
        status = "CANCELLED";
      }

      const deliveryFee = 2500 + i * 200;

      const delivery = await prisma.delivery.create({
        data: {
          trackingId: `CXR-${Date.now()}-${String(i).padStart(3, "0")}`,
          vendorId: vendor.vendorProfile.id,
          riderId: rider?.riderProfile?.id || null,
          recipientName: `Customer ${i}`,
          recipientPhone: `08012345${String(i).padStart(3, "0")}`,
          recipientAddress:
            recipientLocations[(i - 1) % recipientLocations.length],
          packageType: packageTypes[(i - 1) % packageTypes.length],
          packageWeight: `${i + 1} kg`,
          deliveryInstructions:
            i % 2 === 0
              ? "Please call the recipient before delivery."
              : "Handle package with care.",
          riderFee: deliveryFee,
          deliveryPin: String(1000 + i),
          status,
          payments: {
            create: {
              amount: deliveryFee,
              currency: "NGN",
              status: status === "PENDING" ? "PENDING" : "SUCCESS",
              reference: `PAY-REF-${Date.now()}-${i}`,
              method: "PAYSTACK",
              vendorId: vendor.vendorProfile.id,
            },
          },
        },
        include: {
          payments: true,
        },
      });

      if (status === "PENDING") {
        for (let riderIndex = 0; riderIndex < 3; riderIndex++) {
          const targetRider = riders[(i + riderIndex) % riders.length];

          await prisma.deliveryRequest.create({
            data: {
              deliveryId: delivery.id,
              riderId: targetRider.riderProfile.id,
              status: "PENDING",
              distanceFromPickup: Number(
                (Math.random() * 5 + 0.5).toFixed(2)
              ),
              expiresAt: new Date(Date.now() + 1000 * 60 * 30),
            },
          });
        }
      }

      if (
        rider &&
        ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED"].includes(
          status
        )
      ) {
        await prisma.deliveryRequest.create({
          data: {
            deliveryId: delivery.id,
            riderId: rider.riderProfile.id,
            status: "ACCEPTED",
            distanceFromPickup: Number(
              (Math.random() * 5 + 0.5).toFixed(2)
            ),
            respondedAt: now,
          },
        });
      }

      console.log(
        `📦 Delivery created: ${delivery.trackingId} | ` +
          `Status: ${status} | ` +
          `Rider: ${rider?.fullName || "Unassigned"} | ` +
          `Payment: ${delivery.payments[0]?.status}`
      );
    }

    console.log("\n🎉 DATABASE SEEDED SUCCESSFULLY!\n");
  } catch (error) {
    console.error("\n❌ Database seeding failed:\n");
    console.error(error);
  } finally {
    await prisma.$disconnect();
  }
};

seed();