import PaymentIntent from "../models/PaymentIntent.js";
import PaymentTransaction from "../models/PaymentTransaction.js";
import WebhookEvent from "../models/WebhookEvent.js";
import WebhookLog from "../models/WebhookLog.js";
import User from "../models/User.js";
import AuditLog from "../models/AuditLog.js";
import emailService from "./email.service.js";
import crypto from "crypto";

// Maximum pending intents per user (prevent spam)
const MAX_PENDING_INTENTS = 5;

class PaymentService {
  // Create payment intent and generate QR
  async createPaymentIntent(userId, plan) {
    // Validate plan
    const validPlans = [
      "pro_monthly",
      "pro_yearly",
      "credits_50",
      "credits_100",
    ];
    if (!validPlans.includes(plan)) {
      throw new Error("INVALID_PLAN");
    }

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    // Check pending intents limit to prevent spam
    const pendingCount = await PaymentIntent.countDocuments({
      userId,
      status: "pending",
      expiresAt: { $gt: new Date() }, // Only count non-expired
    });

    if (pendingCount >= MAX_PENDING_INTENTS) {
      throw new Error("TOO_MANY_PENDING_INTENTS");
    }

    // Create intent
    const intent = await PaymentIntent.createIntent(userId, plan);

    // Generate QR URL
    const qrCodeUrl = intent.generateQRUrl();
    intent.qrData.qrCodeUrl = qrCodeUrl;
    await intent.save();

    // Log audit
    await AuditLog.log("payment_intent_created", {
      userId,
      metadata: {
        plan,
        amount: intent.amount,
        transferCode: intent.transferCode,
      },
    });

    return {
      id: intent._id,
      plan: intent.plan,
      amount: intent.amount,
      currency: intent.currency,
      transferCode: intent.transferCode,
      expiresAt: intent.expiresAt,
      remainingTime: intent.getRemainingTime(),
      qrData: {
        bankCode: intent.qrData.bankCode,
        accountNumber: intent.qrData.accountNumber,
        accountName: intent.qrData.accountName,
        description: intent.qrData.description,
        qrCodeUrl: intent.qrData.qrCodeUrl,
      },
    };
  }

  // Get payment intent status (for polling)
  async getIntentStatus(intentId, userId) {
    const intent = await PaymentIntent.findOne({ _id: intentId, userId });

    if (!intent) {
      throw new Error("INTENT_NOT_FOUND");
    }

    return {
      id: intent._id,
      status: intent.getClientStatus(),
      amount: intent.amount,
      transferCode: intent.transferCode,
      expiresAt: intent.expiresAt,
      remainingTime: intent.getRemainingTime(),
      paidAt: intent.paidAt,
      isExpired: intent.isExpired(),
    };
  }

  // Get user payment history
  async getPaymentHistory(userId, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [transactions, total] = await Promise.all([
      PaymentTransaction.getUserHistory(userId, limit, skip),
      PaymentTransaction.countDocuments({ userId, status: "matched" }),
    ]);

    return {
      transactions,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  // Verify SePay API Key (Webhook Auth)
  verifySePaySignature(authHeader) {
    const apiKey = process.env.SEPAY_API_KEY;

    if (!apiKey) {
      console.warn("SEPAY_API_KEY not configured");
      return true; // Skip if not configured (dev mode)
    }

    if (!authHeader) {
      if (process.env.NODE_ENV === "production") {
        console.error(
          "No authorization header provided for SePay in production",
        );
        return false;
      }
      return true;
    }

    // SePay sends: "Apikey YOUR_API_KEY"
    const providedKey = authHeader.replace("Apikey ", "").trim();
    return providedKey === apiKey;
  }

  // Process SePay webhook
  async processSePayWebhook(payload, authHeader, headers = {}) {
    const startTime = Date.now();
    let authStatus = "skipped";

    // 1. Verify API Key
    const isAuthorized = this.verifySePaySignature(authHeader);

    if (!isAuthorized && process.env.SEPAY_API_KEY) {
      authStatus = "invalid";
      await WebhookLog.create({
        provider: "sepay",
        headers,
        body: payload,
        signatureStatus: authStatus,
        processingStatus: "failed",
        error: "INVALID_API_KEY",
        responseTime: Date.now() - startTime,
      });
      throw new Error("INVALID_SIGNATURE");
    }

    const log = await WebhookLog.create({
      provider: "sepay",
      headers,
      body: payload,
      signatureStatus: isAuthorized ? "verified" : "skipped",
      processingStatus: "pending",
    });

    try {
      // SePay usually sends a single transaction per webhook
      const result = await this.processSePayTransaction(payload);

      // Update log
      log.processingStatus =
        result.status === "success"
          ? "processed"
          : result.status === "unmatched"
            ? "unmatched"
            : "failed";
      log.results = [result];
      log.responseTime = Date.now() - startTime;
      await log.save();

      return { status: "processed", results: [result] };
    } catch (error) {
      console.error("SePay webhook processing error:", error);
      log.processingStatus = "failed";
      log.error = error.message;
      log.responseTime = Date.now() - startTime;
      await log.save();
      throw error;
    }
  }

  // Process single SePay transaction
  async processSePayTransaction(tx) {
    const {
      id: sePayTxId,
      transferAmount: amount,
      content: description,
      transferType,
      transactionDate,
      referenceCode,
    } = tx;

    const providerTxId = (sePayTxId || `sepay_${Date.now()}`).toString();

    // Only process "in" (money in) transactions
    if (transferType !== "in") {
      return { status: "ignored", reason: "NOT_INCOMING_TRANSFER" };
    }

    // Check idempotency
    const existingTx = await PaymentTransaction.findOne({ providerTxId });
    if (existingTx) {
      return { status: "duplicate", providerTxId };
    }

    // Parse transfer code from content (equivalent to description in Casso)
    const transferCode = PaymentIntent.parseTransferCode(description);

    if (!transferCode) {
      await PaymentTransaction.createFromWebhook({
        providerTxId,
        amount,
        description,
        status: "unmatched",
        provider: "vietqr_sepay",
        rawPayload: tx,
      });
      return { status: "unmatched", error: "NO_TRANSFER_CODE" };
    }

    // Find intent
    const intent = await PaymentIntent.findOne({ transferCode });

    if (!intent) {
      await PaymentTransaction.createFromWebhook({
        providerTxId,
        amount,
        description,
        transferCode,
        status: "unmatched",
        provider: "vietqr_sepay",
        rawPayload: tx,
      });
      return { status: "intent_not_found", error: "INTENT_NOT_FOUND" };
    }

    // Check if paid or expired
    if (intent.status === "paid") {
      return { status: "already_paid", intentId: intent._id };
    }

    if (intent.isExpired()) {
      intent.status = "expired";
      await intent.save();

      // Vẫn tạo transaction để admin có thể manual match
      await PaymentTransaction.createFromWebhook({
        providerTxId,
        intentId: intent._id,
        userId: intent.userId,
        amount,
        description,
        transferCode,
        status: "unmatched",
        provider: "vietqr_sepay",
        rawPayload: tx,
      });

      return { status: "expired", error: "INTENT_EXPIRED" };
    }

    // Check amount
    if (amount < intent.amount) {
      intent.status = "underpaid";
      await intent.save();
      return { status: "underpaid", error: "AMOUNT_MISMATCH" };
    }

    // SUCCESS
    const transaction = await PaymentTransaction.createFromWebhook({
      providerTxId,
      intentId: intent._id,
      userId: intent.userId,
      amount,
      description,
      transferCode,
      status: "matched",
      provider: "vietqr_sepay",
      rawPayload: tx,
    });

    await intent.markAsPaid(transaction._id);
    await this.upgradeUser(intent.userId, intent.plan, intent._id);

    // Email notification
    setImmediate(async () => {
      try {
        const user = await User.findById(intent.userId);
        if (user) {
          await emailService.sendPaymentConfirmation(
            user.email,
            intent.plan,
            intent.amount,
            intent.transferCode,
          );
        }
      } catch (e) {
        console.error("Email error:", e);
      }
    });

    return {
      status: "success",
      transactionId: transaction._id,
      intentId: intent._id,
    };
  }

  // Upgrade user based on plan
  async upgradeUser(userId, plan, paymentIntentId) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (plan.startsWith("pro_")) {
      await user.upgradeToPro(plan, paymentIntentId);

      // Log audit
      await AuditLog.log("plan_upgraded", {
        userId,
        metadata: { plan, paymentIntentId },
      });
    } else if (plan.startsWith("credits_")) {
      const creditsMap = {
        credits_50: 50,
        credits_100: 100,
      };
      const credits = creditsMap[plan] || 0;
      await user.addCredits(credits);

      // Log audit
      await AuditLog.log("payment_completed", {
        userId,
        metadata: { plan, credits, paymentIntentId },
      });
    }

    return user;
  }

  // Get pricing info
  getPricing() {
    return PaymentIntent.getPricing();
  }

  // Cancel expired intents (can be run as cron job)
  async cancelExpiredIntents() {
    const result = await PaymentIntent.updateMany(
      {
        status: "pending",
        expiresAt: { $lt: new Date() },
      },
      {
        status: "expired",
      },
    );

    console.log("Cancelled expired intents:", result.modifiedCount);
    return result.modifiedCount;
  }

  // Get unmatched transactions for admin review
  async getUnmatchedTransactions(limit = 50) {
    return await PaymentTransaction.getUnmatched(limit);
  }

  // Manual match transaction to intent (admin function)
  async manualMatchTransaction(transactionId, intentId) {
    const transaction = await PaymentTransaction.findById(transactionId);
    const intent = await PaymentIntent.findById(intentId);

    if (!transaction || !intent) {
      throw new Error("NOT_FOUND");
    }

    if (intent.status === "paid") {
      throw new Error("INTENT_ALREADY_PAID");
    }

    // Update transaction
    transaction.intentId = intentId;
    transaction.userId = intent.userId;
    transaction.status = "matched";
    transaction.processedAt = new Date();
    await transaction.save();

    // Mark intent as paid
    await intent.markAsPaid(transaction._id);

    // Upgrade user
    await this.upgradeUser(intent.userId, intent.plan, intent._id);

    return { transaction, intent };
  }
}

// Export singleton instance
const paymentService = new PaymentService();
export default paymentService;
