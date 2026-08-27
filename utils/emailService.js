import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// =========================================
// VENDOR WELCOME EMAIL
// =========================================
export const sendVendorWelcomeEmail = async ({ email, fullName, businessName }) => {
  const dashboardUrl = `${process.env.FRONTEND_URL}/vendor/login`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to CourierX</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 40px 10px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" style="max-width: 560px; background-color: #121215; border: 1px solid #27272a; border-radius: 24px; padding: 40px; text-align: left;">
              
              <!-- LOGO / BRAND HEADER -->
              <tr>
                <td style="padding-bottom: 24px; border-bottom: 1px solid #27272a;">
                  <span style="font-size: 22px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px;">
                    Courier<span style="color: #f97316;">X</span>
                  </span>
                  <span style="display: inline-block; margin-left: 10px; background-color: rgba(249, 115, 22, 0.1); color: #f97316; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 9999px; text-transform: uppercase; border: 1px solid rgba(249, 115, 22, 0.2);">
                    Merchant Partner
                  </span>
                </td>
              </tr>

              <!-- BODY -->
              <tr>
                <td style="padding-top: 32px;">
                  <h1 style="font-size: 24px; font-weight: 800; color: #ffffff; margin: 0 0 12px 0;">
                    Welcome aboard, ${fullName}! 🚀
                  </h1>
                  <p style="font-size: 14px; line-height: 1.6; color: #a1a1aa; margin: 0 0 20px 0;">
                    Your business account for <strong style="color: #ffffff;">${businessName}</strong> has been successfully created. You can now start dispatching packages with dynamic real-time tracking across our logistics network.
                  </p>

                  <!-- QUICK STEPS CARD -->
                  <div style="background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 20px; margin-bottom: 28px;">
                    <p style="font-size: 12px; font-weight: 800; color: #f97316; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px 0;">
                      Next Steps to Get Started:
                    </p>
                    <ul style="margin: 0; padding-left: 18px; color: #d4d4d8; font-size: 13px; line-height: 1.8;">
                      <li>Complete your store address & pickup details</li>
                      <li>Create your first instant delivery request</li>
                      <li>Track assigned riders in real-time</li>
                    </ul>
                  </div>

                  <!-- CTA BUTTON -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <a href="${dashboardUrl}" style="display: inline-block; background-color: #f97316; color: #000000; font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; padding: 14px 32px; border-radius: 14px; text-decoration: none;">
                      Go to Vendor Dashboard &rarr;
                    </a>
                  </div>

                  <p style="font-size: 12px; color: #71717a; margin: 0;">
                    If you didn't create an account on CourierX, please ignore this email or contact support immediately.
                  </p>
                </td>
              </tr>

              <!-- FOOTER -->
              <tr>
                <td style="padding-top: 32px; border-top: 1px solid #27272a; margin-top: 32px; font-size: 11px; color: #52525b; text-align: center;">
                  &copy; ${new Date().getFullYear()} CourierX Technologies Ltd. All rights reserved.
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return transporter.sendMail({
    from: `"CourierX Logistics" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `Welcome to CourierX, ${fullName}! Store Account Active`,
    html: htmlContent,
  });
};

// =========================================
// RIDER WELCOME EMAIL
// =========================================
export const sendRiderWelcomeEmail = async ({ email, fullName }) => {
  const riderAppUrl = `${process.env.FRONTEND_URL}/rider/login`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to CourierX Fleet</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 40px 10px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" style="max-width: 560px; background-color: #121215; border: 1px solid #27272a; border-radius: 24px; padding: 40px; text-align: left;">
              
              <!-- LOGO / BRAND HEADER -->
              <tr>
                <td style="padding-bottom: 24px; border-bottom: 1px solid #27272a;">
                  <span style="font-size: 22px; font-weight: 900; color: #ffffff; letter-spacing: -0.5px;">
                    Courier<span style="color: #f97316;">X</span>
                  </span>
                  <span style="display: inline-block; margin-left: 10px; background-color: rgba(16, 185, 129, 0.1); color: #10b981; font-size: 10px; font-weight: 800; padding: 3px 8px; border-radius: 9999px; text-transform: uppercase; border: 1px solid rgba(16, 185, 129, 0.2);">
                    Logistics Fleet
                  </span>
                </td>
              </tr>

              <!-- BODY -->
              <tr>
                <td style="padding-top: 32px;">
                  <h1 style="font-size: 24px; font-weight: 800; color: #ffffff; margin: 0 0 12px 0;">
                    Welcome to the Fleet, ${fullName}! 🏍️
                  </h1>
                  <p style="font-size: 14px; line-height: 1.6; color: #a1a1aa; margin: 0 0 20px 0;">
                    Thank you for applying to deliver with CourierX. Your driver account is now registered and pending initial account verification.
                  </p>

                  <!-- VERIFICATION NOTICE -->
                  <div style="background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; padding: 20px; margin-bottom: 28px;">
                    <p style="font-size: 12px; font-weight: 800; color: #10b981; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px 0;">
                      Verification Checklist:
                    </p>
                    <ul style="margin: 0; padding-left: 18px; color: #d4d4d8; font-size: 13px; line-height: 1.8;">
                      <li>Upload your valid ID & driver's license</li>
                      <li>Provide your vehicle details (Bike/Car/Van)</li>
                      <li>Wait for admin clearance to go online & earn</li>
                    </ul>
                  </div>

                  <!-- CTA BUTTON -->
                  <div style="text-align: center; margin-bottom: 32px;">
                    <a href="${riderAppUrl}" style="display: inline-block; background-color: #10b981; color: #000000; font-size: 13px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; padding: 14px 32px; border-radius: 14px; text-decoration: none;">
                      Open Rider Dashboard &rarr;
                    </a>
                  </div>

                  <p style="font-size: 12px; color: #71717a; margin: 0;">
                    If you didn't submit a application to CourierX, please ignore this email.
                  </p>
                </td>
              </tr>

              <!-- FOOTER -->
              <tr>
                <td style="padding-top: 32px; border-top: 1px solid #27272a; margin-top: 32px; font-size: 11px; color: #52525b; text-align: center;">
                  &copy; ${new Date().getFullYear()} CourierX Logistics Fleet. All rights reserved.
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return transporter.sendMail({
    from: `"CourierX Fleet" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
    to: email,
    subject: `Welcome to CourierX Fleet, ${fullName}! Next steps to get started`,
    html: htmlContent,
  });
};