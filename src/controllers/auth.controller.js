import User from "../models/User.js";
import OTPToken from "../models/OTPToken.js";
import AuditLog from "../models/AuditLog.js";
import emailService from "../services/email.service.js";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// Helper: Get client IP and User-Agent
const getClientInfo = (req) => ({
  ip: req.ip || req.headers["x-forwarded-for"] || req.connection?.remoteAddress,
  userAgent: req.headers["user-agent"],
});

// Helper: Generate tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRY || "1h",
  });

  const refreshToken = crypto.randomBytes(40).toString("hex");

  return { accessToken, refreshToken };
};

// ==================== REGISTER ====================
export const register = async (req, res) => {
  try {
    const { email, password, confirmPassword, name } = req.body;
    const clientInfo = getClientInfo(req);

    // Validation
    if (!email || !password || !confirmPassword || !name) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Vui lòng nhập đầy đủ thông tin",
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "INVALID_EMAIL",
        message: "Email không hợp lệ",
      });
    }

    // Password validation: min 8 chars, 1 uppercase, 1 number
    if (password.length < 8) {
      return res.status(400).json({
        error: "PASSWORD_TOO_SHORT",
        message: "Mật khẩu phải có ít nhất 8 ký tự",
      });
    }

    if (!/[A-Z]/.test(password)) {
      return res.status(400).json({
        error: "PASSWORD_NO_UPPERCASE",
        message: "Mật khẩu phải chứa ít nhất 1 chữ hoa",
      });
    }

    if (!/[0-9]/.test(password)) {
      return res.status(400).json({
        error: "PASSWORD_NO_NUMBER",
        message: "Mật khẩu phải chứa ít nhất 1 số",
      });
    }

    // Confirm password
    if (password !== confirmPassword) {
      return res.status(400).json({
        error: "PASSWORD_MISMATCH",
        message: "Mật khẩu xác nhận không khớp",
      });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      // Don't reveal if email exists for security
      if (existingUser.isEmailVerified) {
        return res.status(409).json({
          error: "EMAIL_EXISTS",
          message: "Email đã được sử dụng",
        });
      } else {
        // User exists but not verified - allow re-registration
        await User.deleteOne({ _id: existingUser._id });
      }
    }

    // [TESTING] Tạm comment OTP rate limit để test nhiều
    // const canSendOTP = await OTPToken.checkRateLimit(
    //   email.toLowerCase(),
    //   "signup"
    // );
    // if (!canSendOTP) {
    //   return res.status(429).json({
    //     error: "OTP_RATE_LIMIT",
    //     message: "Quá nhiều yêu cầu OTP, vui lòng thử lại sau 1 giờ",
    //   });
    // }

    // Create user (pending status)
    const user = await User.create({
      email: email.toLowerCase(),
      password,
      name,
      accountStatus: "pending",
      isEmailVerified: false,
    });

    // Generate and send OTP
    const { otp } = await OTPToken.generateOTP(
      email.toLowerCase(),
      "signup",
      user._id,
      clientInfo,
    );

    // ✅ CRITICAL: Return response IMMEDIATELY - don't block on email
    res.status(201).json({
      message: "Đăng ký thành công. Vui lòng kiểm tra email để xác thực.",
      otpSent: true,
      email: user.email,
    });

    // ✅ Send email AFTER response (fire-and-forget) using setImmediate
    setImmediate(async () => {
      try {
        const emailResult = await emailService.sendOTP(email, otp, "signup");
        console.log(
          `[Register] OTP email sent for ${email}:`,
          emailResult.correlationId,
        );

        // Update audit log with correlation ID for tracing
        await AuditLog.updateOne(
          {
            userId: user._id,
            action: "otp_sent",
            createdAt: { $gte: new Date(Date.now() - 5000) }, // Last 5 seconds
          },
          {
            $set: {
              "metadata.emailCorrelationId": emailResult.correlationId,
              "metadata.emailDuration": emailResult.duration,
            },
          },
        );
      } catch (err) {
        console.error(
          `[Register] Failed to send signup OTP email for ${email}:`,
          err.message,
        );
        // Email failure doesn't block user registration
        // User can request resend if needed
      }
    });

    // ✅ Audit logs fire-and-forget (no await to prevent blocking email)
    AuditLog.log("signup", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
      status: "success",
    }).catch((err) =>
      console.error("[Register] Audit log failed:", err.message),
    );

    AuditLog.log("otp_sent", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
      metadata: { purpose: "signup" },
    }).catch((err) =>
      console.error("[Register] Audit log failed:", err.message),
    );

    console.log(`[Register] Response sent, email queued for ${email}`);
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi đăng ký tài khoản",
    });
  }
};

// ==================== VERIFY EMAIL OTP ====================
export const verifyEmailOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const clientInfo = getClientInfo(req);

    if (!email || !otp) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Vui lòng nhập email và mã OTP",
      });
    }

    // Validate OTP format (6 digits)
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        error: "INVALID_OTP_FORMAT",
        message: "Mã OTP phải gồm 6 chữ số",
      });
    }

    // Find OTP token
    const otpToken = await OTPToken.findActiveOTP(
      email.toLowerCase(),
      "signup",
    );

    if (!otpToken) {
      return res.status(400).json({
        error: "OTP_NOT_FOUND",
        message: "Mã OTP không tồn tại hoặc đã hết hạn",
      });
    }

    // Verify OTP
    try {
      await otpToken.verifyOTP(otp);
    } catch (otpError) {
      await AuditLog.log("otp_failed", {
        email: email.toLowerCase(),
        ...clientInfo,
        metadata: { error: otpError.message, purpose: "signup" },
      });

      const errorMessages = {
        OTP_EXPIRED: "Mã OTP đã hết hạn",
        OTP_ALREADY_USED: "Mã OTP đã được sử dụng",
        OTP_MAX_ATTEMPTS: "Quá nhiều lần thử sai. Vui lòng yêu cầu mã mới",
        OTP_INVALID: `Mã OTP không đúng. Còn ${5 - otpToken.attempts} lần thử`,
      };

      return res.status(400).json({
        error: otpError.message,
        message: errorMessages[otpError.message] || "Xác thực OTP thất bại",
        attemptsRemaining:
          otpError.message === "OTP_INVALID" ? 5 - otpToken.attempts : 0,
      });
    }

    // Find and activate user
    const user = await User.findById(otpToken.userId);
    if (!user) {
      return res.status(400).json({
        error: "USER_NOT_FOUND",
        message: "Tài khoản không tồn tại",
      });
    }

    await user.activateAccount();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);
    await user.addRefreshToken(
      refreshToken,
      clientInfo.userAgent,
      clientInfo.ip,
    );

    // Audit logs
    await AuditLog.log("otp_verified", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
      metadata: { purpose: "signup" },
    });

    await AuditLog.log("email_verified", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
    });

    res.status(200).json({
      message: "Xác thực email thành công!",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        subscription: user.subscription,
      },
      token: accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi xác thực OTP",
    });
  }
};

// ==================== RESEND OTP ====================
export const resendOTP = async (req, res) => {
  try {
    const { email, purpose = "signup" } = req.body;
    const clientInfo = getClientInfo(req);

    if (!email) {
      return res.status(400).json({
        error: "MISSING_EMAIL",
        message: "Vui lòng nhập email",
      });
    }

    // [TESTING] Tạm comment rate limit & cooldown để test nhiều
    // const canSendOTP = await OTPToken.checkRateLimit(
    //   email.toLowerCase(),
    //   purpose
    // );
    // if (!canSendOTP) {
    //   return res.status(429).json({
    //     error: "OTP_RATE_LIMIT",
    //     message: "Quá nhiều yêu cầu OTP, vui lòng thử lại sau 1 giờ",
    //   });
    // }

    // [TESTING] Tạm comment cooldown check
    // const existingOTP = await OTPToken.findActiveOTP(
    //   email.toLowerCase(),
    //   purpose
    // );
    // if (existingOTP && !existingOTP.canResend()) {
    //   const cooldownRemaining = existingOTP.getRemainingCooldown();
    //   return res.status(429).json({
    //     error: "RESEND_COOLDOWN",
    //     message: `Vui lòng chờ ${cooldownRemaining} giây trước khi gửi lại`,
    //     cooldownRemaining,
    //     resendsRemaining: 3 - existingOTP.resendCount,
    //   });
    // }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });

    if (purpose === "signup") {
      if (!user) {
        return res.status(400).json({
          error: "USER_NOT_FOUND",
          message: "Tài khoản không tồn tại. Vui lòng đăng ký",
        });
      }
      if (user.isEmailVerified) {
        return res.status(400).json({
          error: "ALREADY_VERIFIED",
          message: "Email đã được xác thực",
        });
      }
    }

    // Generate new OTP
    const { otp } = await OTPToken.generateOTP(
      email.toLowerCase(),
      purpose,
      user?._id || null,
      clientInfo,
    );

    // ✅ Return response IMMEDIATELY
    res.status(200).json({
      message: "Đã gửi lại mã OTP",
      otpSent: true,
    });

    // ✅ Send email AFTER response (fire-and-forget)
    setImmediate(async () => {
      try {
        const emailResult = await emailService.sendOTP(email, otp, purpose);
        console.log(
          `[ResendOTP] Email sent for ${email}:`,
          emailResult.correlationId,
        );

        // Update audit log with correlation ID
        await AuditLog.updateOne(
          {
            email: email.toLowerCase(),
            action: "otp_sent",
            createdAt: { $gte: new Date(Date.now() - 5000) },
          },
          {
            $set: {
              "metadata.emailCorrelationId": emailResult.correlationId,
              "metadata.emailDuration": emailResult.duration,
              "metadata.isResend": true,
            },
          },
        );
      } catch (err) {
        console.error(
          `[ResendOTP] Failed to send email for ${email}:`,
          err.message,
        );
      }
    });

    // ✅ Audit log fire-and-forget
    AuditLog.log("otp_sent", {
      userId: user?._id,
      email: email.toLowerCase(),
      ...clientInfo,
      metadata: { purpose, isResend: true },
    }).catch((err) =>
      console.error("[ResendOTP] Audit log failed:", err.message),
    );

    console.log(`[ResendOTP] Response sent, email queued for ${email}`);
  } catch (error) {
    console.error("Resend OTP error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi gửi lại OTP",
    });
  }
};

// ==================== LOGIN ====================
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const clientInfo = getClientInfo(req);

    if (!email || !password) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Vui lòng nhập email và mật khẩu",
      });
    }

    // Find user
    const user = await User.findForLogin(email);

    if (!user) {
      // Don't reveal if email exists
      await AuditLog.log("login_failed", {
        email: email.toLowerCase(),
        ...clientInfo,
        status: "failed",
        metadata: { reason: "USER_NOT_FOUND" },
      });

      return res.status(401).json({
        error: "INVALID_CREDENTIALS",
        message: "Email hoặc mật khẩu không đúng",
      });
    }

    // Check if account is locked
    if (!user.canLogin()) {
      const lockTime = user.getRemainingLockTime();
      return res.status(403).json({
        error: "ACCOUNT_LOCKED",
        message: `Tài khoản tạm khóa. Vui lòng thử lại sau ${Math.ceil(
          lockTime / 60,
        )} phút`,
        lockTimeRemaining: lockTime,
      });
    }

    // Check account status
    if (user.accountStatus === "suspended") {
      return res.status(403).json({
        error: "ACCOUNT_SUSPENDED",
        message: "Tài khoản đã bị đình chỉ",
      });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      await user.incrementLoginAttempts();

      await AuditLog.log("login_failed", {
        userId: user._id,
        email: user.email,
        ...clientInfo,
        status: "failed",
        metadata: {
          reason: "WRONG_PASSWORD",
          failedAttempts: user.security.failedLoginAttempts,
        },
      });

      const attemptsRemaining = 5 - user.security.failedLoginAttempts;
      return res.status(401).json({
        error: "INVALID_CREDENTIALS",
        message:
          attemptsRemaining > 0
            ? `Email hoặc mật khẩu không đúng. Còn ${attemptsRemaining} lần thử`
            : "Tài khoản đã bị khóa do nhập sai quá nhiều lần",
        attemptsRemaining,
      });
    }

    // Reset login attempts on success
    await user.resetLoginAttempts();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id);
    await user.addRefreshToken(
      refreshToken,
      clientInfo.userAgent,
      clientInfo.ip,
    );

    // Update last login
    user.lastLoginAt = new Date();
    await user.save();

    // Audit log
    await AuditLog.log("login", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
    });

    res.status(200).json({
      message: "Đăng nhập thành công!",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        subscription: user.subscription,
      },
      token: accessToken,
      refreshToken,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi đăng nhập",
    });
  }
};

// ==================== LOGOUT ====================
export const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const user = req.user;
    const clientInfo = getClientInfo(req);

    if (refreshToken && user) {
      // Invalidate specific refresh token
      await user.verifyRefreshToken(refreshToken);
    }

    // Audit log
    await AuditLog.log("logout", {
      userId: user?._id,
      ...clientInfo,
    });

    res.status(200).json({
      message: "Đăng xuất thành công",
    });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi đăng xuất",
    });
  }
};

// ==================== FORGOT PASSWORD ====================
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const clientInfo = getClientInfo(req);

    if (!email) {
      return res.status(400).json({
        error: "MISSING_EMAIL",
        message: "Vui lòng nhập email",
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: "INVALID_EMAIL",
        message: "Email không hợp lệ",
      });
    }

    // Always return success to prevent email enumeration
    const successResponse = {
      message: "Nếu email tồn tại, mã OTP sẽ được gửi đến hộp thư",
      otpSent: true,
    };

    // Check rate limit
    const canSendOTP = await OTPToken.checkRateLimit(
      email.toLowerCase(),
      "reset_password",
    );
    if (!canSendOTP) {
      // Still return success to prevent timing attacks
      return res.status(200).json(successResponse);
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // ✅ Return error if email not found (KISS - user requested)
      return res.status(404).json({
        error: "USER_NOT_FOUND",
        message: "Email không tồn tại trong hệ thống",
      });
    }

    // Generate OTP
    const { otp } = await OTPToken.generateOTP(
      email.toLowerCase(),
      "reset_password",
      user._id,
      clientInfo,
    );

    // ✅ Return response IMMEDIATELY (security: same response even if user not found)
    res.status(200).json(successResponse);

    // ✅ Send email AFTER response (fire-and-forget)
    setImmediate(async () => {
      try {
        const emailResult = await emailService.sendOTP(
          email,
          otp,
          "reset_password",
        );
        console.log(
          `[ForgotPassword] Email sent for ${email}:`,
          emailResult.correlationId,
        );

        // Update audit log with correlation ID
        await AuditLog.updateOne(
          {
            userId: user._id,
            action: "otp_sent",
            createdAt: { $gte: new Date(Date.now() - 5000) },
          },
          {
            $set: {
              "metadata.emailCorrelationId": emailResult.correlationId,
              "metadata.emailDuration": emailResult.duration,
            },
          },
        );
      } catch (err) {
        console.error(
          `[ForgotPassword] Failed to send email for ${email}:`,
          err.message,
        );
      }
    });

    // ✅ Audit logs fire-and-forget
    AuditLog.log("password_reset_requested", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
    }).catch((err) =>
      console.error("[ForgotPassword] Audit log failed:", err.message),
    );

    AuditLog.log("otp_sent", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
      metadata: { purpose: "reset_password" },
    }).catch((err) =>
      console.error("[ForgotPassword] Audit log failed:", err.message),
    );

    console.log(`[ForgotPassword] Response sent, email queued for ${email}`);
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi xử lý yêu cầu",
    });
  }
};

// ==================== VERIFY RESET OTP ====================
export const verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const clientInfo = getClientInfo(req);

    if (!email || !otp) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Vui lòng nhập email và mã OTP",
      });
    }

    // Validate OTP format
    if (!/^\d{6}$/.test(otp)) {
      return res.status(400).json({
        error: "INVALID_OTP_FORMAT",
        message: "Mã OTP phải gồm 6 chữ số",
      });
    }

    // Find OTP token
    const otpToken = await OTPToken.findActiveOTP(
      email.toLowerCase(),
      "reset_password",
    );

    if (!otpToken) {
      return res.status(400).json({
        error: "OTP_NOT_FOUND",
        message: "Mã OTP không tồn tại hoặc đã hết hạn",
      });
    }

    // Verify OTP
    try {
      await otpToken.verifyOTP(otp);
    } catch (otpError) {
      await AuditLog.log("otp_failed", {
        email: email.toLowerCase(),
        ...clientInfo,
        metadata: { error: otpError.message, purpose: "reset_password" },
      });

      const errorMessages = {
        OTP_EXPIRED: "Mã OTP đã hết hạn",
        OTP_ALREADY_USED: "Mã OTP đã được sử dụng",
        OTP_MAX_ATTEMPTS: "Quá nhiều lần thử sai. Vui lòng yêu cầu mã mới",
        OTP_INVALID: `Mã OTP không đúng. Còn ${5 - otpToken.attempts} lần thử`,
      };

      return res.status(400).json({
        error: otpError.message,
        message: errorMessages[otpError.message] || "Xác thực OTP thất bại",
      });
    }

    // Generate reset token (short-lived, used for reset password step)
    const resetToken = jwt.sign(
      { userId: otpToken.userId, purpose: "reset_password" },
      process.env.JWT_SECRET,
      { expiresIn: "10m" },
    );

    // Audit log
    await AuditLog.log("otp_verified", {
      userId: otpToken.userId,
      email: email.toLowerCase(),
      ...clientInfo,
      metadata: { purpose: "reset_password" },
    });

    res.status(200).json({
      message: "Xác thực OTP thành công. Vui lòng đặt mật khẩu mới",
      resetToken,
    });
  } catch (error) {
    console.error("Verify reset OTP error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi xác thực OTP",
    });
  }
};

// ==================== RESET PASSWORD ====================
export const resetPassword = async (req, res) => {
  try {
    const { resetToken, newPassword, confirmPassword } = req.body;
    const clientInfo = getClientInfo(req);

    if (!resetToken || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: "MISSING_FIELDS",
        message: "Vui lòng nhập đầy đủ thông tin",
      });
    }

    // Password validation
    if (newPassword.length < 8) {
      return res.status(400).json({
        error: "PASSWORD_TOO_SHORT",
        message: "Mật khẩu phải có ít nhất 8 ký tự",
      });
    }

    if (!/[A-Z]/.test(newPassword)) {
      return res.status(400).json({
        error: "PASSWORD_NO_UPPERCASE",
        message: "Mật khẩu phải chứa ít nhất 1 chữ hoa",
      });
    }

    if (!/[0-9]/.test(newPassword)) {
      return res.status(400).json({
        error: "PASSWORD_NO_NUMBER",
        message: "Mật khẩu phải chứa ít nhất 1 số",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: "PASSWORD_MISMATCH",
        message: "Mật khẩu xác nhận không khớp",
      });
    }

    // Verify reset token
    let decoded;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (tokenError) {
      return res.status(400).json({
        error: "INVALID_RESET_TOKEN",
        message: "Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn",
      });
    }

    if (decoded.purpose !== "reset_password") {
      return res.status(400).json({
        error: "INVALID_RESET_TOKEN",
        message: "Token không hợp lệ",
      });
    }

    // Find user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(400).json({
        error: "USER_NOT_FOUND",
        message: "Tài khoản không tồn tại",
      });
    }

    // Update password
    user.password = newPassword; // Will be hashed by pre-save hook
    user.security.lastPasswordResetAt = new Date();
    await user.save();

    // Invalidate all refresh tokens (security measure)
    await user.invalidateAllRefreshTokens();

    // Audit log
    await AuditLog.log("password_reset_completed", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
    });

    await AuditLog.log("password_changed", {
      userId: user._id,
      email: user.email,
      ...clientInfo,
    });

    res.status(200).json({
      message: "Đặt lại mật khẩu thành công! Vui lòng đăng nhập lại",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi đặt lại mật khẩu",
    });
  }
};

// ==================== REFRESH TOKEN ====================
export const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    const clientInfo = getClientInfo(req);

    if (!token) {
      return res.status(400).json({
        error: "MISSING_REFRESH_TOKEN",
        message: "Refresh token không được cung cấp",
      });
    }

    // Find user by checking all refresh tokens
    const users = await User.find({ "refreshTokens.0": { $exists: true } });

    let foundUser = null;
    for (const user of users) {
      const isValid = await user.verifyRefreshToken(token);
      if (isValid) {
        foundUser = user;
        break;
      }
    }

    if (!foundUser) {
      return res.status(401).json({
        error: "INVALID_REFRESH_TOKEN",
        message: "Refresh token không hợp lệ hoặc đã hết hạn",
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(
      foundUser._id,
    );
    await foundUser.addRefreshToken(
      newRefreshToken,
      clientInfo.userAgent,
      clientInfo.ip,
    );

    res.status(200).json({
      token: accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi làm mới token",
    });
  }
};

// ==================== GET PROFILE (Protected) ====================
export const getProfile = async (req, res) => {
  try {
    const user = req.user;

    res.status(200).json({
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      subscription: user.subscription,
      isEmailVerified: user.isEmailVerified,
      accountStatus: user.accountStatus,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({
      error: "INTERNAL_ERROR",
      message: "Lỗi lấy thông tin profile",
    });
  }
};
