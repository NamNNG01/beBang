import { Router } from "express";
import {
  register,
  verifyEmailOTP,
  resendOTP,
  login,
  logout,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  refreshToken,
  getProfile,
} from "../controllers/auth.controller.js";
import { authMiddleware } from "../middlewares/auth.middleware.js";
import {
  loginLimiter,
  registerLimiter,
  otpLimiter,
  forgotPasswordLimiter,
} from "../middlewares/rateLimiter.middleware.js";

const router = Router();

// ==================== PUBLIC ROUTES ====================

// Register new user (sends OTP)
// [TESTING] Tạm comment rate limiter để test nhiều
// router.post("/register", registerLimiter, register);
router.post("/register", register);

// Verify email OTP
router.post("/verify-email-otp", verifyEmailOTP);

// Resend OTP
// [TESTING] Tạm comment rate limiter để test nhiều
// router.post("/resend-otp", otpLimiter, resendOTP);
router.post("/resend-otp", resendOTP);

// Login
router.post("/login", loginLimiter, login);

// Forgot password (sends reset OTP)
router.post("/forgot-password", forgotPasswordLimiter, forgotPassword);

// Verify reset OTP
router.post("/verify-reset-otp", verifyResetOTP);

// Reset password
router.post("/reset-password", resetPassword);

// Refresh token
router.post("/refresh", refreshToken);

// ==================== PROTECTED ROUTES ====================

// Logout
router.post("/logout", authMiddleware, logout);

// Get profile
router.get("/profile", authMiddleware, getProfile);

export default router;
