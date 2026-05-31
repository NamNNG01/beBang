import express from "express";
import cors from "cors";
import userRouter from "./routes/user.routes.js";
import aiRouter from "./routes/ai.routes.js";
import conversationRouter from "./routes/conversation.routes.js";
import authRouter from "./routes/auth.routes.js";
import paymentRouter from "./routes/payment.routes.js";
import adminRouter from "./routes/admin.routes.js";
import { generalLimiter } from "./middlewares/rateLimiter.middleware.js";

const app = express();

// Trust proxy - Quan trọng khi chạy trên Railway/Vercel sau load balancer
app.set("trust proxy", 1);

// CORS Configuration - Cho phép Excel Add-in và Production URL gọi API
app.use(
  cors({
    origin: [
      "https://localhost:3000",
      "http://localhost:3000",
      "https://localhost:4000",
      "http://localhost:4000",
      "https://localhost:4001",
      "http://localhost:4001",
      "null", // Excel taskpane origin
      // Production URLs - Vercel
      "https://excel-add-in-six.vercel.app",
      "https://excel-add-in-git-main-minhto1511s-projects.vercel.app",
      "https://excel-add-in-jbfg5qld4-minhto1511s-projects.vercel.app",
      "https://fe-i6iw385vx-abdafs-projects.vercel.app",
      // External payment page (eofficeai.io.vn)
      "https://eofficeai.io.vn",
      "https://www.eofficeai.io.vn",
      process.env.ALLOWED_ORIGINS,
    ].filter(Boolean),
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning",
    ],
    exposedHeaders: ["X-Request-ID"],
  }),
);

app.options("*", cors());
// Custom JSON parser that preserves raw body for webhook signature verification
app.use(
  express.json({
    verify: (req, res, buf) => {
      // Store raw body for webhook signature verification
      req.rawBody = buf.toString();
    },
  }),
);

// General rate limiter
app.use(generalLimiter);

// API Routes
app.use("/api/v1/users", userRouter);
app.use("/api/v1/ai", aiRouter);
app.use("/api/v1/conversations", conversationRouter);

// New routes for auth and payment
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/payments", paymentRouter);
app.use("/api/v1/admin", adminRouter);

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({ status: "OK", timestamp: new Date() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "NOT_FOUND", message: "Endpoint not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res
    .status(500)
    .json({ error: "INTERNAL_ERROR", message: "Internal server error" });
});

export default app;
