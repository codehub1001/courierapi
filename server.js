import express from "express";
import cors from "cors";
import dotenv from "dotenv";
dotenv.config();
import cookieParser from "cookie-parser";
import path from "path";
import { fileURLToPath } from "url";
import http from "http";
import { Server } from "socket.io";
import { registerTrackingSocketHandlers } from "./utils/trackingSocket.js";
import { pollUnassignedDeliveries } from "./service/deliveryPoller.js"; // 👉 Import the poller

import walletRoutes from "./routes/walletRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import vendorRoutes from "./routes/vendorRoutes.js";
import deliveryRoutes from "./routes/deliveryRoutes.js";
import riderRoutes from "./routes/riderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import verifyRoutes from "./routes/verifyRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import uploadRoutes from "./routes/uploadRoutes.js";
import supportRoutes from "./routes/supportRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// =====================================================
// 1. HTTP & SOCKET.IO INITIALIZATION
// =====================================================
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "https://courierx.vercel.app",
];

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// Make io accessible in Express routes via req.app.get("io")
app.set("io", io);

// =====================================================
// 2. SOCKET.IO CONNECTION LISTENER
// =====================================================
io.on("connection", (socket) => {
  console.log(`⚡ Client connected to Socket.io: ${socket.id}`);

  registerTrackingSocketHandlers(io, socket);

  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

// =====================================================
// 3. MIDDLEWARE & STATIC FILES
// =====================================================
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

app.use(express.json());
app.use(cookieParser());

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// =====================================================
// 4. API ROUTES
// =====================================================
app.use("/api/users", userRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/deliveries", deliveryRoutes);
app.use("/api/v1/rider", riderRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/v1/wallet", walletRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/rider", riderRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api", verifyRoutes);
app.use("/api/support", supportRoutes);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "CourierX API is running 🚚",
  });
});

// =====================================================
// 5. SERVER START & BACKGROUND JOBS
// =====================================================
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 CourierX server running on port ${PORT}`);

  // 👉 Optional: Run once immediately on startup so you don't wait 5 mins for the first check
  pollUnassignedDeliveries();

  // 👉 Run background poller every 5 minutes for unassigned PENDING deliveries
  setInterval(pollUnassignedDeliveries, 5 * 60 * 1000);
});