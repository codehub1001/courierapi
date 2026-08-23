import prisma from "../prismaClient.js";

import { Resend } from "resend";

// Define the helper function properly without a top-level constructor
export const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Missing API key. RESEND_API_KEY is not defined in environment variables.");
  }
  return new Resend(apiKey);
};

// 1. Create Support Ticket (Public)
export const createSupportTicket = async (req, res) => {
  try {
    const { fullName, email, phone, trackingId, subject, message } = req.body;

    if (!fullName || !email || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Please fill in all required fields (fullName, email, subject, message).",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanTrackingId = trackingId && trackingId.trim() !== "" ? trackingId.trim() : null;

    // Verify delivery if trackingId is provided
    if (cleanTrackingId) {
      const deliveryExists = await prisma.delivery.findUnique({
        where: { trackingId: cleanTrackingId },
      });
      if (!deliveryExists) {
        console.warn(`⚠️ [Support Ticket] Provided trackingId "${cleanTrackingId}" does not exist in database.`);
      }
    }

    // Save ticket in database
    const newTicket = await prisma.supportTicket.create({
      data: {
        fullName: fullName.trim(),
        email: normalizedEmail,
        phone: phone ? phone.trim() : null,
        trackingId: cleanTrackingId,
        subject,
        message: message.trim(),
      },
    });

    const resend = getResend();

    // Send notification email to Internal Dispatch Team
    try {
      await resend.emails.send({
        from: "CourierX Support <security@resend.dev>",
        to: "dispatch@courierx.com",
        subject: `[Support Ticket] ${subject.toUpperCase()} - ${fullName}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #f97316; margin-top: 0;">New Support Ticket Received</h2>
            <p><strong>Ticket ID:</strong> ${newTicket.id}</p>
            <p><strong>Name:</strong> ${fullName}</p>
            <p><strong>Email:</strong> ${normalizedEmail}</p>
            <p><strong>Phone:</strong> ${phone || "N/A"}</p>
            <p><strong>Tracking ID:</strong> ${cleanTrackingId || "N/A"}</p>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Message:</strong></p>
            <blockquote style="background: #f8fafc; padding: 12px; border-left: 4px solid #f97316; margin: 0;">
              ${message}
            </blockquote>
          </div>
        `,
      });
    } catch (emailErr) {
      console.error("❌ Failed to send internal team alert email:", emailErr);
    }

    // Send confirmation email back to the User
    try {
      await resend.emails.send({
        from: "CourierX Support <security@resend.dev>",
        to: normalizedEmail,
        subject: `We've received your CourierX support request [${newTicket.id}]`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 500px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px;">
            <h2 style="color: #f97316; margin-top: 0;">Hello ${fullName},</h2>
            <p>Thank you for reaching out to CourierX. We have received your support ticket regarding <strong>"${subject}"</strong> and our dispatch team is looking into it.</p>
            <p>Your tracking/reference ID is: <strong>${newTicket.id}</strong></p>
            <p>We typically respond within a few hours during operating hours.</p>
            <br/>
            <p style="color: #718096; font-size: 12px;">Best regards,<br/><strong>CourierX Support Team</strong></p>
          </div>
        `,
      });
    } catch (userEmailErr) {
      console.error("❌ Failed to send user confirmation email:", userEmailErr);
    }

    return res.status(201).json({
      success: true,
      message: "Support ticket submitted successfully.",
      ticketId: newTicket.id,
    });

  } catch (error) {
    console.error("💥 [Support Ticket Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while processing support ticket.",
    });
  }
};

// 2. Admin: Get All Support Tickets
export const getAllSupportTickets = async (req, res) => {
  try {
    const { status } = req.query; // Optional filter e.g. ?status=OPEN

    const whereClause = status ? { status: status.toUpperCase() } : {};

    const tickets = await prisma.supportTicket.findMany({
      where: whereClause,
      include: {
        delivery: true, // Includes delivery details if a trackingId was linked
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      success: true,
      count: tickets.length,
      tickets,
    });
  } catch (error) {
    console.error("💥 [Get Tickets Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching support tickets.",
    });
  }
};

// 3. Admin: Update Ticket Status (e.g. IN_PROGRESS, RESOLVED, CLOSED)
export const updateTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
      });
    }

    const updatedTicket = await prisma.supportTicket.update({
      where: { id },
      data: { status: status.toUpperCase() },
    });

    return res.status(200).json({
      success: true,
      message: "Support ticket status updated successfully.",
      ticket: updatedTicket,
    });
  } catch (error) {
    console.error("💥 [Update Ticket Error]:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating support ticket.",
    });
  }
};