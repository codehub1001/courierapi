import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";

import walletRoutes from "./routes/walletRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import vendorRoutes from "./routes/vendorRoutes.js";
import deliveryRoutes from "./routes/deliveryRoutes.js";
import riderRoutes from "./routes/riderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import verifyRoutes from "./routes/verifyRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js"; // 👈 Import upload routes
import supportRoutes from "./routes/supportRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://courierx.vercel.app"
    ],
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// 👈 Serve uploaded files statically so previews load properly
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// User & Feature routes
app.use("/api/users", userRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/v1/rider", riderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/rider", riderRoutes);
app.use("/api/upload", uploadRoutes); // 👈 Mount the upload router here
app.use("/api", verifyRoutes);
app.use("/api/support", supportRoutes);
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "CourierX API is running 🚚",
  });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`CourierX server running on port ${PORT}`);
});