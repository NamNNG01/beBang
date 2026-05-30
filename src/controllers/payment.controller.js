import paymentService from "../services/payment.service.js";
import PaymentIntent from "../models/PaymentIntent.js";
import AuditLog from "../models/AuditLog.js";

// Helper: Get client IP
const getClientInfo = (req) => ({
  ip: req.ip || req.headers["x-forwarded-for"] || req.connection?.remoteAddress,
  userAgent: req.headers["user-agent"],
});

// ==================== CREATE PAYMENT INTENT ====================
export const createPaymentIntent = async (req, res) => {
  try {
    const { plan } = req.body;
    const userId = req.user._id;
    const clientInfo = getClientInfo(req);

    if (!plan) {
      return res.status(400).json({
        error: "MISSING_PLAN",
        message: "Vui lòng chọn gói thanh toán",
      });
    }

    // Validate plan
    const validPlans = [
      "pro_monthly",
      "pro_yearly",
      "credits_50",
      "credits_100",
    ];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({
        error: "INVALID_PLAN",
        message: "Gói thanh toán không hợp lệ",
        validPlans,
      });
    }

    // Check if user already has active pro subscription
    if (req.user.subscription.plan === "pro" && plan.startsWith("pro_")) {
      const endDate = req.user.subscription.endDate;
      if (endDate && endDate > new Date()) {
        return res.status(400).json({
          error: "ALREADY_PRO",
          message: "Bạn đã có gói Pro đang hoạt động",
          expiresAt: endDate,
        });
      }
    }

    const intent = await paymentService.createPaymentIntent(userId, plan);

    res.status(201).json({
      message: "Tạo yêu cầu thanh toán thành công",
      intent,
    });
  } catch (error) {
    console.error("Create payment intent error:", error);

    if (error.message === "INVALID_PLAN") {
      return res.status(400).json({
        error: "INVALID_PLAN",
        message: "Gói thanh toán không hợp lệ",
      });
    }

    if (error.message === "TOO_MANY_PENDING_INTENTS") {
      return res.status(429).json({
        error: "TOO_MANY_PENDING_INTENTS",
        message:
          "Bạn có quá nhiều yêu cầu thanh toán đang chờ. Vui lòng thanh toán hoặc đợi hết hạn trước khi tạo yêu cầu mới (tối đa 5 yêu cầu)",
      });
    }

    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi tạo yêu cầu thanh toán",
    });
  }
};

// ==================== GET PAYMENT INTENT STATUS ====================
export const getPaymentIntentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const status = await paymentService.getIntentStatus(id, userId);

    // ✅ FIX: Prevent caching in Office WebView
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.status(200).json(status);
  } catch (error) {
    console.error("Get intent status error:", error);

    if (error.message === "INTENT_NOT_FOUND") {
      return res.status(404).json({
        error: "INTENT_NOT_FOUND",
        message: "Không tìm thấy yêu cầu thanh toán",
      });
    }

    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi lấy trạng thái thanh toán",
    });
  }
};

// ==================== GET PAYMENT HISTORY ====================
export const getPaymentHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const history = await paymentService.getPaymentHistory(userId, page, limit);

    res.status(200).json(history);
  } catch (error) {
    console.error("Get payment history error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi lấy lịch sử thanh toán",
    });
  }
};

// ==================== GET PRICING ====================
export const getPricing = async (req, res) => {
  try {
    const pricing = paymentService.getPricing();

    const pricingDetails = {
      pro_monthly: {
        name: "Pro Hàng Tháng",
        price: pricing.pro_monthly,
        currency: "VND",
        features: [
          "Không giới hạn AI prompts",
          "Phân tích dữ liệu nâng cao",
          "Hỗ trợ ưu tiên",
        ],
        period: "1 tháng",
      },
      pro_yearly: {
        name: "Pro Hàng Năm",
        price: pricing.pro_yearly,
        currency: "VND",
        features: [
          "Không giới hạn AI prompts",
          "Phân tích dữ liệu nâng cao",
          "Hỗ trợ ưu tiên",
          "Tiết kiệm 20%",
        ],
        period: "1 năm",
      },
      credits_50: {
        name: "Gói 50 Credits",
        price: pricing.credits_50,
        currency: "VND",
        credits: 50,
      },
      credits_100: {
        name: "Gói 100 Credits",
        price: pricing.credits_100,
        currency: "VND",
        credits: 100,
      },
    };

    res.status(200).json({
      pricing: pricingDetails,
    });
  } catch (error) {
    console.error("Get pricing error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi lấy thông tin giá",
    });
  }
};

// ==================== SEPAY WEBHOOK ====================
export const handleSePayWebhook = async (req, res) => {
  try {
    const payload = req.body;
    const authHeader = req.headers["authorization"]; // Format: "Apikey API_KEY"

    console.log("SePay webhook received:");
    console.log("- Auth Header:", authHeader ? "Present" : "None");
    console.log(
      "- Payload preview:",
      JSON.stringify(payload).substring(0, 200),
    );

    // Process webhook
    const result = await paymentService.processSePayWebhook(
      payload,
      authHeader,
      req.headers,
    );

    // SePay requires 200 or 201 with { success: true } for acknowledgement
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("SePay webhook error:", error);

    if (error.message === "INVALID_SIGNATURE") {
      return res.status(401).json({
        success: false,
        error: "INVALID_SIGNATURE",
      });
    }

    // Return 200 with success: false to prevent retries for logic errors
    res.status(200).json({
      success: false,
      error: error.message,
    });
  }
};

// ==================== VNPAY WEBHOOK (Placeholder) ====================
export const handleVNPayWebhook = async (req, res) => {
  try {
    // Placeholder for VNPay integration
    console.log("VNPay webhook received:", req.body);

    res.status(200).json({
      RspCode: "00",
      Message: "Success",
    });
  } catch (error) {
    console.error("VNPay webhook error:", error);
    res.status(200).json({
      RspCode: "99",
      Message: "Error",
    });
  }
};

// ==================== ADMIN: GET UNMATCHED TRANSACTIONS ====================
export const getUnmatchedTransactions = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Bạn không có quyền truy cập",
      });
    }

    const limit = parseInt(req.query.limit) || 50;
    const transactions = await paymentService.getUnmatchedTransactions(limit);

    res.status(200).json({
      transactions,
      total: transactions.length,
    });
  } catch (error) {
    console.error("Get unmatched transactions error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi lấy danh sách giao dịch chưa khớp",
    });
  }
};

// ==================== ADMIN: MANUAL MATCH TRANSACTION ====================
export const manualMatchTransaction = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Bạn không có quyền truy cập",
      });
    }

    const { transactionId, intentId } = req.body;

    if (!transactionId || !intentId) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Vui lòng cung cấp transactionId và intentId",
      });
    }

    const result = await paymentService.manualMatchTransaction(
      transactionId,
      intentId,
    );

    // Audit log
    await AuditLog.log("admin_manual_match", {
      userId: req.user._id,
      metadata: {
        transactionId,
        intentId,
      },
    });

    res.status(200).json({
      message: "Khớp giao dịch thành công",
      ...result,
    });
  } catch (error) {
    console.error("Manual match error:", error);

    if (error.message === "NOT_FOUND") {
      return res.status(404).json({
        error: "NOT_FOUND",
        message: "Không tìm thấy giao dịch hoặc intent",
      });
    }

    if (error.message === "INTENT_ALREADY_PAID") {
      return res.status(400).json({
        error: "INTENT_ALREADY_PAID",
        message: "Intent đã được thanh toán",
      });
    }

    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi khớp giao dịch",
    });
  }
};
