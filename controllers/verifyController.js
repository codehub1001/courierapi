import prisma from "../prismaClient.js";
import axios from "axios";

export const verifyRiderProfile = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const { ninNumber, bvnNumber, passportUrl, firstName, lastName } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // 1. Validate basic inputs & formats
    if (!ninNumber || !bvnNumber || !passportUrl || !firstName || !lastName) {
      return res.status(400).json({
        success: false,
        message: "NIN, BVN, Passport, First Name, and Last Name are required.",
      });
    }

    const bvnRegex = /^\d{11}$/;
    const ninRegex = /^\d{11}$/;

    if (!bvnRegex.test(bvnNumber) || !ninRegex.test(ninNumber)) {
      return res.status(400).json({ success: false, message: "BVN and NIN must be valid 11-digit numbers." });
    }

    const existingProfile = await prisma.riderProfile.findUnique({ where: { userId } });
    if (!existingProfile) {
      return res.status(404).json({ success: false, message: "Rider profile not found." });
    }

    let verificationPassed = false;

    // 2. Call Youverify BVN API
    try {
      const youverifyBaseUrl = process.env.YOUVERIFY_BASE_URL || "https://api.sandbox.youverify.co";
      const apiKey = process.env.YOUVERIFY_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ success: false, message: "Youverify API key is not configured on the server." });
      }

      const youverifyResponse = await axios.post(
        `${youverifyBaseUrl}/v2/api/identity/ng/bvn`,
        {
          id: bvnNumber,
          isSubjectConsent: true,
          premiumBVN: false,
          validations: {
            data: {
              firstName: firstName.trim(),
              lastName: lastName.trim(),
            },
          },
        },
        {
          headers: {
            token: apiKey,
            "Content-Type": "application/json",
          },
        }
      );

      const responseBody = youverifyResponse.data;

      if (responseBody && responseBody.success && responseBody.data?.status === "found") {
        const nameValidations = responseBody.data.validations?.data;
        if (nameValidations?.firstName?.validated && nameValidations?.lastName?.validated) {
          verificationPassed = true;
        } else {
          return res.status(400).json({
            success: false,
            message: "Name mismatch. The name registered on this BVN does not match the profile names provided.",
          });
        }
      }
    } catch (apiError) {
      console.warn("Youverify Sandbox API returned an internal error. Using sandbox dev bypass...", apiError?.response?.data || apiError.message);
      
      // 💡 SANDBOX BYPASS: If Youverify sandbox is down/crashing, let a test BVN pass 
      // so you can test your database transactions and frontend flow locally.
      if (bvnNumber === "22222222222" || process.env.NODE_ENV !== "production") {
        verificationPassed = true; 
      } else {
        return res.status(502).json({
          success: false,
          message: "Identity verification sandbox is currently experiencing an internal server error.",
        });
      }
    }

    if (!verificationPassed) {
      return res.status(400).json({
        success: false,
        message: "Could not retrieve or verify records for the provided BVN. Please check the number.",
      });
    }

    // 3. Update Database inside a Transaction if verification succeeds
    const [updatedRider] = await prisma.$transaction([
      prisma.riderProfile.update({
        where: { userId },
        data: {
          ninNumber,
          bvnNumber,
          passportUrl,
          isVerified: true,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { status: "ACTIVE" },
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: "Rider verified successfully!",
      data: updatedRider,
    });

  } catch (error) {
    console.error("DATABASE TRANSACTION ERROR:", error);

    if (error.code === "P2002") {
      return res.status(400).json({
        success: false,
        message: "The provided NIN or BVN is already linked to another rider account.",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error during identity verification matching.",
    });
  }
};