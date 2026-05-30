import { Router } from "express";
import {
  authenticate,
  adminMiddleware,
} from "../middlewares/auth.middleware.js";
import {
  getStats,
  getTransactions,
  getUsers,
  getWebhookLogs,
  upgradeUserToPro,
} from "../controllers/admin.controller.js";
import {
  manualMatchTransaction,
  getUnmatchedTransactions,
} from "../controllers/payment.controller.js";
import emailService from "../services/email.service.js";

const router = Router();

// Tất cả các route admin đều yêu cầu Auth + Admin role
router.use(authenticate, adminMiddleware);

/**
 * Dashboard Stats
 */
router.get("/stats", getStats);

/**
 * Transactions Management
 */
router.get("/transactions", getTransactions);
router.get("/transactions/unmatched", getUnmatchedTransactions);
router.post("/transactions/manual-match", manualMatchTransaction);

/**
 * User Management
 */
router.get("/users", getUsers);
router.post("/users/:userId/upgrade", upgradeUserToPro);

/**
 * Webhook Logs
 */
router.get("/webhook-logs", getWebhookLogs);

/**
 * Test Email - Debug endpoint
 */
router.post("/test-email", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    // Check email service config
    const verifyResult = await emailService.verifyConnection();

    if (!verifyResult.success) {
      return res.status(500).json({
        error: "EMAIL_SERVICE_ERROR",
        message: "Email service không hoạt động",
        details: verifyResult.error,
        config: {
          EMAIL_USER: process.env.EMAIL_USER ? "✓ Set" : "✗ Missing",
          EMAIL_PASSWORD: process.env.EMAIL_PASSWORD ? "✓ Set" : "✗ Missing",
          EMAIL_SERVICE: process.env.EMAIL_SERVICE || "gmail (default)",
        },
      });
    }

    // Send test email
    const result = await emailService.sendOTP(email, "123456", "signup");

    res.json({
      success: true,
      message: "Test email sent successfully!",
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("Test email error:", error);
    res.status(500).json({
      error: "EMAIL_SEND_FAILED",
      message: error.message,
      stack: error.stack,
    });
  }
});

export default router;
