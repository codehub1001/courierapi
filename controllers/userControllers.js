import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";
import { generateShortCode } from "../utils/generator.js";
import { Resend } from "resend";
const resendClient = new Resend(process.env.RESEND_API_KEY);

export const getResend = () => {
  return resendClient;
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
