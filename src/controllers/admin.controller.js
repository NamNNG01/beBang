import User from "../models/User.js";
import PaymentIntent from "../models/PaymentIntent.js";
import PaymentTransaction from "../models/PaymentTransaction.js";
import WebhookLog from "../models/WebhookLog.js";
import AuditLog from "../models/AuditLog.js";

/**
 * Admin: Nâng cấp user lên Pro thủ công
 */
export const upgradeUserToPro = async (req, res) => {
  try {
    const { userId } = req.params;
    const { plan = "pro_monthly" } = req.body;

    const validPlans = ["pro_monthly", "pro_yearly"];
    if (!validPlans.includes(plan)) {
      return res.status(400).json({
        error: "INVALID_PLAN",
        message: "Gói không hợp lệ. Chọn pro_monthly hoặc pro_yearly",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: "USER_NOT_FOUND",
        message: "Không tìm thấy người dùng",
      });
    }

    await user.upgradeToPro(plan);

    // Audit log
    await AuditLog.log("admin_manual_upgrade", {
      userId: req.user._id,
      metadata: {
        targetUserId: userId,
        targetEmail: user.email,
        plan,
      },
    });

    res.status(200).json({
      message: `Đã nâng cấp ${user.email} lên ${plan === "pro_monthly" ? "Pro Tháng" : "Pro Năm"}`,
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        subscription: user.subscription,
      },
    });
  } catch (error) {
    console.error("Admin upgrade user error:", error);
    res
      .status(500)
      .json({ error: "INTERNAL_ERROR", message: "Lỗi nâng cấp user" });
  }
};

/**
 * Lấy thống kê tổng quan cho Dashboard
 * Chỉ tính từ ngày 6/2 (Feb 6) trở đi
 */
// Mốc thời gian hệ thống bắt đầu tính
const SYSTEM_START_DATE = new Date("2026-02-06T00:00:00.000Z");

// FIX CỨNG DOANH THU GIAI ĐOẠN ĐẦU:
// - LEGACY_FIXED_REVENUE: tổng doanh thu đã đối soát thủ công (ví dụ từ 6/2 tới 15/3)
// - LEGACY_REVENUE_LOCK_DATE: chỉ cộng thêm các giao dịch MATCHED sau mốc này
// => Dashboard hiển thị: DOANH THU = LEGACY_FIXED_REVENUE + doanh thu phát sinh mới
const LEGACY_FIXED_REVENUE = 9398000; // 9.398.000 đ - tổng đã chốt trong file Excel (bỏ phần lẻ 5đ)
const LEGACY_REVENUE_LOCK_DATE = new Date("2099-01-01T00:00:00.000Z"); // tạm thời không cộng thêm doanh thu động

// FIX CỨNG TẠM THỜI: số user hiển thị trên Dashboard (65 Pro + 262 thường = 327 tổng)
const LEGACY_PRO_USERS = 65;
const LEGACY_FREE_USERS = 262;
const LEGACY_TOTAL_USERS = LEGACY_PRO_USERS + LEGACY_FREE_USERS;

export const getStats = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      proUsers,
      postLockRevenue,
      todayRevenue,
      unmatchedCount,
    ] = await Promise.all([
      // Tổng số user kể từ ngày hệ thống bắt đầu tính
      User.countDocuments({ createdAt: { $gte: SYSTEM_START_DATE } }),
      // Số user Pro kể từ ngày hệ thống bắt đầu tính
      User.countDocuments({
        "subscription.plan": "pro",
        createdAt: { $gte: SYSTEM_START_DATE },
      }),
      // Doanh thu phát sinh SAU khi đã chốt số liệu legacy
      // (hiện tại LEGACY_REVENUE_LOCK_DATE đặt rất xa trong tương lai nên kết quả ~ 0)
      PaymentTransaction.aggregate([
        {
          $match: {
            status: "matched",
            createdAt: { $gte: LEGACY_REVENUE_LOCK_DATE },
          },
        },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      // Doanh thu của riêng hôm nay (realtime)
      PaymentTransaction.aggregate([
        { $match: { status: "matched", createdAt: { $gte: today } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      PaymentTransaction.countDocuments({ status: "unmatched" }),
    ]);

    // Tổng doanh thu hiển thị trên Dashboard:
    // - Phần cố định đã đối soát: LEGACY_FIXED_REVENUE = 9.398.000
    // - Cộng thêm doanh thu mới phát sinh sau LEGACY_REVENUE_LOCK_DATE
    const dynamicRevenue =
      postLockRevenue && postLockRevenue.length > 0
        ? postLockRevenue[0].total
        : 0;
    const totalRevenueForDashboard = LEGACY_FIXED_REVENUE + dynamicRevenue;

    // Hiển thị fix cứng số user (65 Pro, 262 thường)
    const displayTotalUsers = LEGACY_TOTAL_USERS;
    const displayProUsers = LEGACY_PRO_USERS;

    res.status(200).json({
      users: {
        total: displayTotalUsers,
        pro: displayProUsers,
      },
      revenue: {
        total: totalRevenueForDashboard,
        today: todayRevenue[0]?.total || 0,
      },
      alerts: {
        unmatched: unmatchedCount,
      },
    });
  } catch (error) {
    console.error("Admin stats error:", error);
    res
      .status(500)
      .json({ error: "INTERNAL_ERROR", message: "Lỗi lấy thống kê" });
  }
};

/**
 * Lấy danh sách giao dịch (có phân trang & filter)
 */
export const getTransactions = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (search) {
      query.$or = [
        { transferCode: new RegExp(search, "i") },
        { description: new RegExp(search, "i") },
      ];
    }

    const transactions = await PaymentTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("userId", "name email");

    const total = await PaymentTransaction.countDocuments(query);

    res.status(200).json({
      transactions,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Admin transactions error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi lấy danh sách giao dịch",
    });
  }
};

/**
 * Lấy danh sách người dùng
 */
export const getUsers = async (req, res) => {
  try {
    const { plan, search, page = 1, limit = 20 } = req.query;
    const query = {};

    if (plan) query["subscription.plan"] = plan;
    if (search) {
      query.$or = [
        { name: new RegExp(search, "i") },
        { email: new RegExp(search, "i") },
      ];
    }

    const users = await User.find(query)
      .select("-password -refreshTokens")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await User.countDocuments(query);

    res.status(200).json({
      users,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Admin users error:", error);
    res
      .status(500)
      .json({ error: "INTERNAL_ERROR", message: "Lỗi lấy danh sách user" });
  }
};

/**
 * Lấy danh sách Webhook Logs
 */
export const getWebhookLogs = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status) query.processingStatus = status;

    const logs = await WebhookLog.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await WebhookLog.countDocuments(query);

    res.status(200).json({
      logs,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Admin webhook logs error:", error);
    res
      .status(500)
      .json({ error: "INTERNAL_ERROR", message: "Lỗi lấy danh sách logs" });
  }
};
