import jwt from "jsonwebtoken";
import User from "../models/User.js";

// Middleware xác thực token
export const authenticate = async (req, res, next) => {
  try {
    // Lấy token từ header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "NO_TOKEN",
        message: "Không có token, vui lòng đăng nhập",
      });
    }

    const token = authHeader.split(" ")[1];

    // Xác thực token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if token was issued before password change
    const user = await User.findById(decoded.id).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ error: "USER_NOT_FOUND", message: "User không tồn tại" });
    }

    // Check if password was changed after token issued
    if (user.security?.passwordChangedAt) {
      const changedAt = Math.floor(
        user.security.passwordChangedAt.getTime() / 1000
      );
      if (decoded.iat < changedAt) {
        return res.status(401).json({
          error: "TOKEN_INVALID",
          message: "Token không còn hợp lệ. Vui lòng đăng nhập lại",
        });
      }
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Lỗi xác thực:", error);
    if (error.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ error: "TOKEN_EXPIRED", message: "Token đã hết hạn" });
    }
    if (error.name === "JsonWebTokenError") {
      return res
        .status(401)
        .json({ error: "TOKEN_INVALID", message: "Token không hợp lệ" });
    }
    res.status(401).json({ error: "AUTH_ERROR", message: "Lỗi xác thực" });
  }
};

// Alias for backward compatibility
export const authMiddleware = authenticate;

// Middleware kiểm tra email verified
export const checkEmailVerified = async (req, res, next) => {
  try {
    const user = req.user;

    if (!user.isEmailVerified) {
      return res.status(403).json({
        error: "EMAIL_NOT_VERIFIED",
        message: "Email chưa được xác thực",
      });
    }

    if (user.accountStatus !== "active") {
      return res.status(403).json({
        error: "ACCOUNT_NOT_ACTIVE",
        message: "Tài khoản chưa được kích hoạt",
      });
    }

    next();
  } catch (error) {
    console.error("Lỗi kiểm tra email:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Lỗi hệ thống" });
  }
};

// Middleware kiểm tra credits
export const checkCredits = async (req, res, next) => {
  try {
    const user = req.user;

    // Pro user hoặc Admin: không giới hạn
    if (user.subscription.plan === "pro" || user.role === "admin") {
      return next();
    }

    // Free user: kiểm tra credits
    if (user.subscription.credits <= 0) {
      return res.status(403).json({
        error: "NO_CREDITS",
        message:
          "Hết lượt sử dụng. Vui lòng nâng cấp lên Pro hoặc chờ gia hạn.",
        credits: 0,
      });
    }

    next();
  } catch (error) {
    console.error("Lỗi kiểm tra credits:", error);
    res
      .status(500)
      .json({ error: "INTERNAL_ERROR", message: "Lỗi kiểm tra credits" });
  }
};
// Middleware kiểm tra quyền admin
export const adminMiddleware = async (req, res, next) => {
  try {
    const user = req.user;
    if (!user || user.role !== "admin") {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Bạn không có quyền truy cập khu vực quản trị",
      });
    }
    next();
  } catch (error) {
    console.error("Lỗi kiểm tra quyền admin:", error);
    res.status(500).json({ error: "INTERNAL_ERROR", message: "Lỗi hệ thống" });
  }
};
