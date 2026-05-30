import rateLimit from "express-rate-limit";

// Helper to get IP safely
const getClientIp = (req) => {
  return (
    req.ip ||
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.connection?.remoteAddress ||
    "unknown"
  );
};

// ==================== GENERAL RATE LIMITER ====================
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // 100 requests per window (changed from max to limit for v7)
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Quá nhiều yêu cầu, vui lòng thử lại sau",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== AUTH RATE LIMITERS ====================

// Login limiter: 5 attempts per 15 minutes per IP
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true, // Don't count successful logins
  message: {
    error: "TOO_MANY_LOGIN_ATTEMPTS",
    message: "Quá nhiều lần đăng nhập thất bại. Vui lòng thử lại sau 15 phút",
  },
  keyGenerator: (req) => {
    // Use email if available, otherwise IP
    const email = req.body?.email?.toLowerCase();
    return email || getClientIp(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Register limiter: 3 attempts per hour per IP
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3,
  message: {
    error: "TOO_MANY_REGISTRATIONS",
    message: "Quá nhiều lần đăng ký. Vui lòng thử lại sau 1 giờ",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP limiter: 3 OTPs per hour per email
export const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3,
  message: {
    error: "OTP_RATE_LIMIT",
    message: "Quá nhiều yêu cầu OTP. Vui lòng thử lại sau 1 giờ",
  },
  keyGenerator: (req) => {
    const email = req.body?.email?.toLowerCase();
    return email || getClientIp(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Forgot password limiter: 3 requests per hour per email
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  message: {
    error: "TOO_MANY_RESET_REQUESTS",
    message: "Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau 1 giờ",
  },
  keyGenerator: (req) => {
    const email = req.body?.email?.toLowerCase();
    return email || getClientIp(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== PAYMENT RATE LIMITERS ====================

// Payment intent limiter: 10 intents per hour per user
export const paymentIntentLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: {
    error: "TOO_MANY_PAYMENT_REQUESTS",
    message: "Quá nhiều yêu cầu thanh toán. Vui lòng thử lại sau",
  },
  keyGenerator: (req) => {
    // req.user is set by authMiddleware before this runs
    const userId = req.user?._id?.toString();
    return userId || getClientIp(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== API RATE LIMITER ====================

// API limiter for authenticated endpoints
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 60, // 60 requests per minute
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Quá nhiều yêu cầu API. Vui lòng chậm lại",
  },
  keyGenerator: (req) => {
    const userId = req.user?._id?.toString();
    return userId || getClientIp(req);
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Strict limiter for sensitive endpoints
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  message: {
    error: "TOO_MANY_REQUESTS",
    message: "Quá nhiều yêu cầu. Vui lòng thử lại sau",
  },
  standardHeaders: true,
  legacyHeaders: false,
});
