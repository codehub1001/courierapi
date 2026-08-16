import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../prismaClient.js";
import { generateShortCode } from "../utils/generator.js";

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

    if (
      !fullName ||
      !username ||
      !email ||
      !phone ||
      !password ||
      !role
    ) {
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
        OR: [
          { email: normalizedEmail },
          { username: normalizedUsername },
        ],
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

    const isPasswordCorrect = await bcrypt.compare(
      password,
      user.password
    );

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
      }
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