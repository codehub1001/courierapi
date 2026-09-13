import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";
import { generateShortCode } from "../utils/generator.js";
import { Resend } from "resend";

export const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key. RESEND_API_KEY is not defined in environment variables.");
  }
  return new Resend(apiKey);
};


export const registerUser = async (req, res) => {
  try {
    const {
      fullName,
      username,
      email,
      phone,
      password,
      role,
      businessName,
      businessType,
      businessAddress,
      vehicleNumber,
      deliveryArea,
    } = req.body;

    if (!fullName || !username || !email || !phone || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields",
      });
    }

    const registrationRoles = ["VENDOR", "RIDER"];

    if (!registrationRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid registration role",
      });
    }

    if (role === "VENDOR") {
      if (!businessName || !businessType || !businessAddress) {
        return res.status(400).json({
          success: false,
          message: "Vendor business details are required",
        });
      }
    }

    if (role === "RIDER") {
      if (!vehicleNumber || !deliveryArea) {
        return res.status(400).json({
          success: false,
          message: "Rider details are required",
        });
      }
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim().toLowerCase();

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: normalizedEmail }, { username: normalizedUsername }],
      },
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message:
          existingUser.email === normalizedEmail
            ? "Email already exists"
            : "Username already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        fullName: fullName.trim(),
        username: normalizedUsername,
        email: normalizedEmail,
        phone: phone.trim(),
        password: hashedPassword,
        role,
      },
    });

    if (role === "VENDOR") {
      let referralCode = generateShortCode("VEND");
      let codeExists = await prisma.vendorProfile.findUnique({
        where: { referralCode },
      });

      while (codeExists) {
        referralCode = generateShortCode("VEND");
        codeExists = await prisma.vendorProfile.findUnique({
          where: { referralCode },
        });
      }

      await prisma.vendorProfile.create({
        data: {
          userId: user.id,
          businessName: businessName.trim(),
          businessType: businessType.trim(),
          businessAddress: businessAddress.trim(),
          referralCode,
        },
      });
    }

    if (role === "RIDER") {
      let referralCode = generateShortCode("RIDE");
      let codeExists = await prisma.riderProfile.findUnique({
        where: { referralCode },
      });

      while (codeExists) {
        referralCode = generateShortCode("RIDE");
        codeExists = await prisma.riderProfile.findUnique({
          where: { referralCode },
        });
      }

      await prisma.riderProfile.create({
        data: {
          userId: user.id,
          vehicleNumber: vehicleNumber.trim(),
          deliveryArea: deliveryArea.trim(),
          referralCode,
        },
      });
    }

    // --- ONBOARDING EMAIL DISPATCH ---
    try {
      const resend = getResend();
      let emailSubject = "";
      let emailHtml = "";

      const baseStyles = `font-family: system-ui, -apple-system, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 24px; background-color: #ffffff;`;

     if (role === "RIDER") {
  emailSubject = "Welcome to CourierX — You're Ready to Ride 🚀";

  emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to CourierX</title>
      </head>

      <body style="margin:0; padding:0; background:#f4f4f5; font-family:Arial, Helvetica, sans-serif; color:#111111;">

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5; padding:30px 12px;">
          <tr>
            <td align="center">

              <!-- Main Container -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="max-width:620px; background:#ffffff; border-radius:20px; overflow:hidden;">

                <!-- Header -->
                <tr>
                  <td style="background:#0b0b0b; padding:28px 32px;">

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="left">
                          <img
                            src="${process.env.LOGO_URL || "https://courierx.vercel.app/courierx-logo.png"}"
                            alt="CourierX"
                            width="145"
                            style="display:block; max-width:145px; height:auto;"
                          >
                        </td>

                        <td align="right">
                          <span style="
                            display:inline-block;
                            background:#FF6801;
                            color:#ffffff;
                            padding:7px 12px;
                            border-radius:30px;
                            font-size:11px;
                            font-weight:bold;
                            letter-spacing:0.8px;
                            text-transform:uppercase;
                          ">
                            Rider
                          </span>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Hero -->
                <tr>
                  <td style="padding:42px 32px 30px 32px;">

                    <div style="
                      width:48px;
                      height:48px;
                      background:#fff1e8;
                      border-radius:14px;
                      text-align:center;
                      line-height:48px;
                      font-size:24px;
                      margin-bottom:20px;
                    ">
                      🚀
                    </div>

                    <h1 style="
                      margin:0 0 12px 0;
                      font-size:30px;
                      line-height:1.2;
                      color:#0b0b0b;
                      font-weight:800;
                    ">
                      Welcome aboard,<br>
                      ${user.fullName}!
                    </h1>

                    <p style="
                      margin:0;
                      color:#666666;
                      font-size:15px;
                      line-height:1.7;
                    ">
                      Your CourierX rider account is ready. You're now part of
                      the delivery network helping businesses move orders
                      across Lagos — faster and smarter.
                    </p>

                  </td>
                </tr>

                <!-- Orange Divider -->
                <tr>
                  <td style="padding:0 32px;">
                    <div style="height:3px; background:#FF6801; border-radius:10px;"></div>
                  </td>
                </tr>

                <!-- How It Works -->
                <tr>
                  <td style="padding:30px 32px 10px 32px;">

                    <p style="
                      margin:0 0 6px 0;
                      color:#FF6801;
                      font-size:11px;
                      font-weight:bold;
                      text-transform:uppercase;
                      letter-spacing:1.5px;
                    ">
                      HOW COURIERX WORKS
                    </p>

                    <h2 style="
                      margin:0;
                      color:#0b0b0b;
                      font-size:22px;
                      font-weight:800;
                    ">
                      Your delivery journey
                    </h2>

                  </td>
                </tr>

                <!-- Step 1 -->
                <tr>
                  <td style="padding:16px 32px 8px 32px;">

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="48" valign="top">
                          <div style="
                            width:38px;
                            height:38px;
                            background:#0b0b0b;
                            color:#ffffff;
                            border-radius:12px;
                            text-align:center;
                            line-height:38px;
                            font-size:14px;
                            font-weight:bold;
                          ">01</div>
                        </td>

                        <td valign="top" style="padding-left:12px;">
                          <h3 style="
                            margin:0 0 5px 0;
                            font-size:15px;
                            color:#111111;
                          ">
                            Get notified
                          </h3>

                          <p style="
                            margin:0;
                            color:#777777;
                            font-size:13px;
                            line-height:1.6;
                          ">
                            When a delivery request is available in your area,
                            CourierX notifies you with the pickup and delivery
                            details.
                          </p>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Step 2 -->
                <tr>
                  <td style="padding:16px 32px 8px 32px;">

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="48" valign="top">
                          <div style="
                            width:38px;
                            height:38px;
                            background:#FF6801;
                            color:#ffffff;
                            border-radius:12px;
                            text-align:center;
                            line-height:38px;
                            font-size:14px;
                            font-weight:bold;
                          ">02</div>
                        </td>

                        <td valign="top" style="padding-left:12px;">
                          <h3 style="
                            margin:0 0 5px 0;
                            font-size:15px;
                            color:#111111;
                          ">
                            Accept the delivery
                          </h3>

                          <p style="
                            margin:0;
                            color:#777777;
                            font-size:13px;
                            line-height:1.6;
                          ">
                            Review the request and accept deliveries that work
                            for you.
                          </p>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Step 3 -->
                <tr>
                  <td style="padding:16px 32px 8px 32px;">

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td width="48" valign="top">
                          <div style="
                            width:38px;
                            height:38px;
                            background:#0b0b0b;
                            color:#ffffff;
                            border-radius:12px;
                            text-align:center;
                            line-height:38px;
                            font-size:14px;
                            font-weight:bold;
                          ">03</div>
                        </td>

                        <td valign="top" style="padding-left:12px;">
                          <h3 style="
                            margin:0 0 5px 0;
                            font-size:15px;
                            color:#111111;
                          ">
                            Pick up & deliver
                          </h3>

                          <p style="
                            margin:0;
                            color:#777777;
                            font-size:13px;
                            line-height:1.6;
                          ">
                            Follow the route, collect the package and deliver
                            it safely to the recipient.
                          </p>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Features -->
                <tr>
                  <td style="padding:28px 32px 10px 32px;">

                    <h2 style="
                      margin:0 0 16px 0;
                      font-size:19px;
                      color:#0b0b0b;
                    ">
                      Built to make riding easier
                    </h2>

                    <table width="100%" cellpadding="0" cellspacing="0">

                      <tr>
                        <td width="50%" valign="top" style="padding:6px;">
                          <div style="
                            background:#f8f8f8;
                            border:1px solid #eeeeee;
                            border-radius:14px;
                            padding:16px;
                          ">
                            <div style="font-size:20px; margin-bottom:8px;">📍</div>

                            <strong style="
                              display:block;
                              font-size:13px;
                              color:#111111;
                              margin-bottom:5px;
                            ">
                              Live Tracking
                            </strong>

                            <span style="
                              color:#777777;
                              font-size:12px;
                              line-height:1.5;
                            ">
                              GPS-powered delivery tracking keeps your journey
                              visible.
                            </span>
                          </div>
                        </td>

                        <td width="50%" valign="top" style="padding:6px;">
                          <div style="
                            background:#f8f8f8;
                            border:1px solid #eeeeee;
                            border-radius:14px;
                            padding:16px;
                          ">
                            <div style="font-size:20px; margin-bottom:8px;">🔔</div>

                            <strong style="
                              display:block;
                              font-size:13px;
                              color:#111111;
                              margin-bottom:5px;
                            ">
                              Smart Alerts
                            </strong>

                            <span style="
                              color:#777777;
                              font-size:12px;
                              line-height:1.5;
                            ">
                              Automatic location-based updates as you approach
                              pickup and drop-off.
                            </span>
                          </div>
                        </td>
                      </tr>

                      <tr>
                        <td width="50%" valign="top" style="padding:6px;">
                          <div style="
                            background:#f8f8f8;
                            border:1px solid #eeeeee;
                            border-radius:14px;
                            padding:16px;
                          ">
                            <div style="font-size:20px; margin-bottom:8px;">₦</div>

                            <strong style="
                              display:block;
                              font-size:13px;
                              color:#111111;
                              margin-bottom:5px;
                            ">
                              Clear Earnings
                            </strong>

                            <span style="
                              color:#777777;
                              font-size:12px;
                              line-height:1.5;
                            ">
                              See your rider earnings for each completed
                              delivery.
                            </span>
                          </div>
                        </td>

                        <td width="50%" valign="top" style="padding:6px;">
                          <div style="
                            background:#f8f8f8;
                            border:1px solid #eeeeee;
                            border-radius:14px;
                            padding:16px;
                          ">
                            <div style="font-size:20px; margin-bottom:8px;">🗺️</div>

                            <strong style="
                              display:block;
                              font-size:13px;
                              color:#111111;
                              margin-bottom:5px;
                            ">
                              Route Assistance
                            </strong>

                            <span style="
                              color:#777777;
                              font-size:12px;
                              line-height:1.5;
                            ">
                              Get location and route information throughout
                              your delivery.
                            </span>
                          </div>
                        </td>
                      </tr>

                    </table>

                  </td>
                </tr>

                <!-- Important -->
                <tr>
                  <td style="padding:24px 32px;">

                    <div style="
                      background:#fff7ed;
                      border-left:4px solid #FF6801;
                      border-radius:10px;
                      padding:16px 18px;
                    ">

                      <strong style="
                        display:block;
                        color:#111111;
                        font-size:13px;
                        margin-bottom:6px;
                      ">
                        Before you go online
                      </strong>

                      <p style="
                        margin:0;
                        color:#666666;
                        font-size:12px;
                        line-height:1.6;
                      ">
                        Keep your phone's location services enabled and make
                        sure your rider profile and verification details are
                        up to date. You will only receive delivery requests
                        once your rider account has been verified and
                        activated.
                      </p>

                    </div>

                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td align="center" style="padding:8px 32px 42px 32px;">

                    <a
                      href="${process.env.FRONTEND_URL || "https://courierx.vercel.app"}/login"
                      style="
                        display:inline-block;
                        background:#FF6801;
                        color:#ffffff;
                        text-decoration:none;
                        padding:15px 30px;
                        border-radius:12px;
                        font-size:14px;
                        font-weight:bold;
                      "
                    >
                      Open Rider Dashboard →
                    </a>

                    <p style="
                      margin:14px 0 0 0;
                      color:#999999;
                      font-size:11px;
                    ">
                      Manage your deliveries, earnings and rider profile.
                    </p>

                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="
                    background:#0b0b0b;
                    padding:26px 32px;
                    text-align:center;
                  ">

                    <img
                      src="${process.env.LOGO_URL || "https://courierx.vercel.app/courierx-logo.png"}"
                      alt="CourierX"
                      width="110"
                      style="display:inline-block; max-width:110px; height:auto; margin-bottom:12px;"
                    >

                    <p style="
                      margin:0;
                      color:#888888;
                      font-size:11px;
                      line-height:1.6;
                    ">
                      You Sell. We Deliver.
                    </p>

                    <p style="
                      margin:8px 0 0 0;
                      color:#666666;
                      font-size:10px;
                    ">
                      © ${new Date().getFullYear()} CourierX. All rights reserved.
                    </p>

                  </td>
                </tr>

              </table>

            </td>
          </tr>
        </table>

      </body>
    </html>
  `;
} else if (role === "VENDOR") {

  emailSubject = "Welcome to CourierX — Start Delivering Faster 🚀";

  emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to CourierX</title>
      </head>

      <body style="margin:0; padding:0; background:#f4f4f5; font-family:Arial, Helvetica, sans-serif; color:#111111;">

        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5; padding:30px 12px;">
          <tr>
            <td align="center">

              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="max-width:620px; background:#ffffff; border-radius:20px; overflow:hidden;">

                <!-- Header -->
                <tr>
                  <td style="background:#0b0b0b; padding:28px 32px;">

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>

                        <td align="left">
                          <img
                            src="${process.env.LOGO_URL || "https://courierx.vercel.app/courierx-logo.png"}"
                            alt="CourierX"
                            width="145"
                            style="display:block; max-width:145px; height:auto;"
                          >
                        </td>

                        <td align="right">
                          <span style="
                            display:inline-block;
                            background:#FF6801;
                            color:#ffffff;
                            padding:7px 12px;
                            border-radius:30px;
                            font-size:11px;
                            font-weight:bold;
                            letter-spacing:0.8px;
                            text-transform:uppercase;
                          ">
                            Vendor
                          </span>
                        </td>

                      </tr>
                    </table>

                  </td>
                </tr>

                <!-- Hero -->
                <tr>
                  <td style="padding:42px 32px 30px 32px;">

                    <div style="
                      width:48px;
                      height:48px;
                      background:#fff1e8;
                      border-radius:14px;
                      text-align:center;
                      line-height:48px;
                      font-size:24px;
                      margin-bottom:20px;
                    ">
                      📦
                    </div>

                    <h1 style="
                      margin:0 0 12px 0;
                      font-size:30px;
                      line-height:1.2;
                      color:#0b0b0b;
                      font-weight:800;
                    ">
                      Welcome to<br>
                      CourierX, ${businessName}!
                    </h1>

                    <p style="
                      margin:0;
                      color:#666666;
                      font-size:15px;
                      line-height:1.7;
                    ">
                      Your business is ready to start sending orders across
                      Lagos with fast, reliable delivery powered by CourierX.
                    </p>

                  </td>
                </tr>

                <!-- Orange Divider -->
                <tr>
                  <td style="padding:0 32px;">
                    <div style="height:3px; background:#FF6801; border-radius:10px;"></div>
                  </td>
                </tr>

                <!-- Process -->
                <tr>
                  <td style="padding:30px 32px 10px 32px;">

                    <p style="
                      margin:0 0 6px 0;
                      color:#FF6801;
                      font-size:11px;
                      font-weight:bold;
                      text-transform:uppercase;
                      letter-spacing:1.5px;
                    ">
                      FROM ORDER TO DOORSTEP
                    </p>

                    <h2 style="
                      margin:0;
                      color:#0b0b0b;
                      font-size:22px;
                      font-weight:800;
                    ">
                      Sending a delivery is simple
                    </h2>

                  </td>
                </tr>

                <!-- Vendor Steps -->
                <tr>
                  <td style="padding:16px 32px 20px 32px;">

                    <table width="100%" cellpadding="0" cellspacing="0">

                      <tr>
                        <td width="48" valign="top">
                          <div style="
                            width:38px;
                            height:38px;
                            background:#0b0b0b;
                            color:#ffffff;
                            border-radius:12px;
                            text-align:center;
                            line-height:38px;
                            font-size:14px;
                            font-weight:bold;
                          ">01</div>
                        </td>

                        <td style="padding-left:12px;" valign="top">

                          <h3 style="
                            margin:0 0 5px 0;
                            font-size:15px;
                          ">
                            Book a delivery
                          </h3>

                          <p style="
                            margin:0;
                            color:#777777;
                            font-size:13px;
                            line-height:1.6;
                          ">
                            Enter your customer's delivery details and package
                            information from your vendor dashboard.
                          </p>

                        </td>
                      </tr>

                      <tr>
                        <td colspan="2" style="height:18px;"></td>
                      </tr>

                      <tr>
                        <td width="48" valign="top">
                          <div style="
                            width:38px;
                            height:38px;
                            background:#FF6801;
                            color:#ffffff;
                            border-radius:12px;
                            text-align:center;
                            line-height:38px;
                            font-size:14px;
                            font-weight:bold;
                          ">02</div>
                        </td>

                        <td style="padding-left:12px;" valign="top">

                          <h3 style="
                            margin:0 0 5px 0;
                            font-size:15px;
                          ">
                            Review your delivery fee
                          </h3>

                          <p style="
                            margin:0;
                            color:#777777;
                            font-size:13px;
                            line-height:1.6;
                          ">
                            Get your delivery price based on the route and
                            delivery distance before confirming.
                          </p>

                        </td>
                      </tr>

                      <tr>
                        <td colspan="2" style="height:18px;"></td>
                      </tr>

                      <tr>
                        <td width="48" valign="top">
                          <div style="
                            width:38px;
                            height:38px;
                            background:#0b0b0b;
                            color:#ffffff;
                            border-radius:12px;
                            text-align:center;
                            line-height:38px;
                            font-size:14px;
                            font-weight:bold;
                          ">03</div>
                        </td>

                        <td style="padding-left:12px;" valign="top">

                          <h3 style="
                            margin:0 0 5px 0;
                            font-size:15px;
                          ">
                            Rider gets assigned
                          </h3>

                          <p style="
                            margin:0;
                            color:#777777;
                            font-size:13px;
                            line-height:1.6;
                          ">
                            Nearby verified riders are notified and a rider
                            accepts the delivery request.
                          </p>

                        </td>
                      </tr>

                      <tr>
                        <td colspan="2" style="height:18px;"></td>
                      </tr>

                      <tr>
                        <td width="48" valign="top">
                          <div style="
                            width:38px;
                            height:38px;
                            background:#FF6801;
                            color:#ffffff;
                            border-radius:12px;
                            text-align:center;
                            line-height:38px;
                            font-size:14px;
                            font-weight:bold;
                          ">04</div>
                        </td>

                        <td style="padding-left:12px;" valign="top">

                          <h3 style="
                            margin:0 0 5px 0;
                            font-size:15px;
                          ">
                            Pay & track
                          </h3>

                          <p style="
                            margin:0;
                            color:#777777;
                            font-size:13px;
                            line-height:1.6;
                          ">
                            Complete your payment and follow the delivery as
                            your rider moves toward your customer.
                          </p>

                        </td>
                      </tr>

                    </table>

                  </td>
                </tr>

                <!-- Feature Grid -->
                <tr>
                  <td style="padding:8px 32px 20px 32px;">

                    <h2 style="
                      margin:0 0 16px 0;
                      font-size:19px;
                      color:#0b0b0b;
                    ">
                      Everything you need to dispatch
                    </h2>

                    <table width="100%" cellpadding="0" cellspacing="0">

                      <tr>

                        <td width="50%" valign="top" style="padding:6px;">
                          <div style="
                            background:#f8f8f8;
                            border:1px solid #eeeeee;
                            border-radius:14px;
                            padding:16px;
                          ">

                            <div style="font-size:20px; margin-bottom:8px;">
                              🗺️
                            </div>

                            <strong style="
                              display:block;
                              font-size:13px;
                              margin-bottom:5px;
                            ">
                              Live Tracking
                            </strong>

                            <span style="
                              color:#777777;
                              font-size:12px;
                              line-height:1.5;
                            ">
                              Track your rider while your delivery is on the
                              move.
                            </span>

                          </div>
                        </td>

                        <td width="50%" valign="top" style="padding:6px;">
                          <div style="
                            background:#f8f8f8;
                            border:1px solid #eeeeee;
                            border-radius:14px;
                            padding:16px;
                          ">

                            <div style="font-size:20px; margin-bottom:8px;">
                              📲
                            </div>

                            <strong style="
                              display:block;
                              font-size:13px;
                              margin-bottom:5px;
                            ">
                              Customer Updates
                            </strong>

                            <span style="
                              color:#777777;
                              font-size:12px;
                              line-height:1.5;
                            ">
                              Keep your customers in the loop with automated SMS or WhatsApp notifications when their order is on the way.
                            </span>

                          </div>
                        </td>

                      </tr>

                      <!-- Second Row of Features -->
                      <tr>
                        <td width="50%" valign="top" style="padding:6px;">
                          <div style="
                            background:#f8f8f8;
                            border:1px solid #eeeeee;
                            border-radius:14px;
                            padding:16px;
                          ">
                            <div style="font-size:20px; margin-bottom:8px;">💳</div>
                            <strong style="
                              display:block;
                              font-size:13px;
                              margin-bottom:5px;
                            ">
                              Secure Payments
                            </strong>
                            <span style="
                              color:#777777;
                              font-size:12px;
                              line-height:1.5;
                            ">
                              Seamless Paystack verification for every delivery request you fund.
                            </span>
                          </div>
                        </td>

                        <td width="50%" valign="top" style="padding:6px;">
                          <div style="
                            background:#f8f8f8;
                            border:1px solid #eeeeee;
                            border-radius:14px;
                            padding:16px;
                          ">
                            <div style="font-size:20px; margin-bottom:8px;">📊</div>
                            <strong style="
                              display:block;
                              font-size:13px;
                              margin-bottom:5px;
                            ">
                              Delivery History
                            </strong>
                            <span style="
                              color:#777777;
                              font-size:12px;
                              line-height:1.5;
                            ">
                              Access detailed records and route data for all your past deliveries.
                            </span>
                          </div>
                        </td>
                      </tr>

                    </table>

                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td align="center" style="padding:24px 32px 42px 32px;">

                    <a
                      href="${process.env.FRONTEND_URL || "https://courierx.vercel.app"}/login"
                      style="
                        display:inline-block;
                        background:#FF6801;
                        color:#ffffff;
                        text-decoration:none;
                        padding:15px 30px;
                        border-radius:12px;
                        font-size:14px;
                        font-weight:bold;
                      "
                    >
                      Open Vendor Dashboard →
                    </a>

                    <p style="
                      margin:14px 0 0 0;
                      color:#999999;
                      font-size:11px;
                    ">
                      Manage your deliveries, payments, and track active riders.
                    </p>

                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="
                    background:#0b0b0b;
                    padding:26px 32px;
                    text-align:center;
                  ">

                    <img
                      src="${process.env.LOGO_URL || "https://courierx.vercel.app/courierx-logo.png"}"
                      alt="CourierX"
                      width="110"
                      style="display:inline-block; max-width:110px; height:auto; margin-bottom:12px;"
                    >

                    <p style="
                      margin:0;
                      color:#888888;
                      font-size:11px;
                      line-height:1.6;
                    ">
                      You Sell. We Deliver.
                    </p>

                    <p style="
                      margin:8px 0 0 0;
                      color:#666666;
                      font-size:10px;
                    ">
                      © ${new Date().getFullYear()} CourierX. All rights reserved.
                    </p>

                  </td>
                </tr>

              </table>

            </td>
          </tr>
        </table>

      </body>
    </html>
  `;
}

      await resend.emails.send({
        from: "CourierX Onboarding <onboarding@resend.dev>", // Update domain when going live
        to: user.email,
        subject: emailSubject,
        html: emailHtml,
      });
      
      console.log(`🎉 [Registration] Welcome email dispatched to: ${user.email} (${role})`);
    } catch (emailError) {
      console.error("❌ [Registration] Failed to send welcome email. User was still created.", emailError);
      // We do not throw or return a 500 here, because the account was successfully created.
    }
    // --- END EMAIL DISPATCH ---

    return res.status(201).json({
      success: true,
      message: "Account created successfully",
      user: {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        role: user.role,
        status: user.status,
      },
    });
  } catch (error) {
    console.error("Registration error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error during registration",
    });
  }
};

export const loginUser = async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Identifier and password are required",
      });
    }

    const normalizedIdentifier = identifier.trim().toLowerCase();

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: normalizedIdentifier },
          { username: normalizedIdentifier },
        ],
      },
      include: {
        vendorProfile: true,
        riderProfile: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials",
      });
    }

    if (user.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        message: "Your account has been suspended",
      });
    }

    // PENDING status check removed for both riders and vendors
    // so they can log in freely without verification bottlenecks.
    // If you only want to enforce pending checks for specific roles (e.g., ADMIN), add them here.

    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      },
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status,
        vendorProfile: user.vendorProfile,
        riderProfile: user.riderProfile,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error during login",
    });
  }
};
export const changePassword = async (req, res) => {
  try {
    const userId = req.user.id; // Provided by your auth middleware
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(
      currentPassword,
      user.password,
    );
    if (!isPasswordCorrect) {
      return res.status(401).json({
        success: false,
        message: "Incorrect current password",
      });
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedNewPassword },
    });

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during password change",
    });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    console.log(
      `🔍 [Forgot Password] Processing request for: "${normalizedEmail}"`,
    );

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    // Security: Don't reveal if the email exists, but return a success message
    if (!user) {
      console.warn(
        `🛡️ [Security] Password reset requested for non-existent email: ${normalizedEmail}`,
      );
      return res.status(200).json({
        success: true,
        message: "If that email exists, a password reset link has been sent.",
      });
    }

    // Generate a secure reset token valid for 15 minutes
    const resetToken = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: "15m",
    });

    const resetLink = `${process.env.FRONTEND_URL || "https://courierx.vercel.app/"}/reset-password?token=${resetToken}`;

    console.log("📧 [Forgot Password] Retrieving Resend instance...");
    const resend = getResend();

    console.log(
      `🛫 [Forgot Password] Dispatching secure reset link to: ${user.email}...`,
    );

    try {
      await resend.emails.send({
        from: "CourierX Security <security@resend.dev>", // Update domain when going live
        to: user.email,
        subject: "Reset your CourierX password",
        html: `
          <div style="font-family: system-ui, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 24px; background-color: #ffffff;">
            <div style="margin-bottom: 24px;">
              <span style="background-color: #fff7ed; color: #f97316; padding: 8px 12px; border-radius: 9999px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;">Account Security</span>
            </div>
            
            <h2 style="color: #0f172a; font-size: 24px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 8px;">Reset Your Password</h2>
            
            <p style="color: #475569; font-size: 15px; line-height: 1.5; margin-bottom: 24px;">
              We received a request to reset the password for your CourierX account. Click the button below to set up a new password:
            </p>
            
            <div style="text-align: left; margin-bottom: 24px;">
              <a href="${resetLink}" style="background-color: #f97316; color: #000000; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-size: 16px; font-weight: 700; display: inline-block; box-shadow: 0 4px 6px -1px rgba(249, 115, 22, 0.2);">
                Reset Password
              </a>
            </div>
            
            <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin-bottom: 24px;">
              Or copy and paste this link into your browser:<br/>
              <a href="${resetLink}" style="color: #f97316; word-break: break-all;">${resetLink}</a>
            </p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin-bottom: 24px;" />
            
            <p style="color: #94a3b8; font-size: 12px; line-height: 1.5;">
              This link is strictly confidential and will expire in exactly 15 minutes. If you didn't initiate this request, you can safely ignore this email and your password will remain unchanged.
            </p>
          </div>
        `,
      });
      console.log("🎉 [Forgot Password] Email dispatched successfully.");
    } catch (emailError) {
      console.error("❌ [Forgot Password] Resend API failed:", emailError);
      throw emailError; // Let the catch block below handle the 500 response
    }

    return res.status(200).json({
      success: true,
      message: "If that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("💥 [CRITICAL CRASH] Forgot password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during password recovery request",
    });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Token and new password are required",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired password reset token",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: decoded.id },
      data: { password: hashedPassword },
    });

    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully. You can now log in.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during password reset",
    });
  }
};
