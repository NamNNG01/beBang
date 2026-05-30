import { Schema, model } from "mongoose";
import { genSalt, hash, compare } from "bcryptjs";

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
      minlength: 8,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    avatar: {
      type: String,
      default: null,
    },

    role: {
      type: String,
      enum: ["user", "admin", "support"],
      default: "user",
    },

    // Account verification & status
    isEmailVerified: {
      type: Boolean,
      default: false,
    },

    accountStatus: {
      type: String,
      enum: ["pending", "active", "locked", "suspended"],
      default: "pending", // pending until email verified
    },

    // Security tracking
    security: {
      failedLoginAttempts: { type: Number, default: 0 },
      lockUntil: { type: Date, default: null },
      passwordChangedAt: { type: Date, default: Date.now },
      lastPasswordResetAt: { type: Date, default: null },
    },

    // Refresh tokens for JWT strategy
    refreshTokens: [
      {
        token: { type: String, required: true }, // hashed
        createdAt: { type: Date, default: Date.now },
        expiresAt: { type: Date, required: true },
        userAgent: String,
        ip: String,
      },
    ],

    // Subscription
    subscription: {
      plan: {
        type: String,
        enum: ["free", "pro"],
        default: "free",
      },
      status: {
        type: String,
        enum: ["active", "expired", "cancelled"],
        default: "active",
      },
      credits: {
        type: Number,
        default: 500,
      },
      startDate: {
        type: Date,
        default: Date.now,
      },
      endDate: { type: Date, default: null }, // for pro plan expiry
      nextBillingDate: Date,
      lastPaymentId: {
        type: Schema.Types.ObjectId,
        ref: "PaymentIntent",
        default: null,
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastLoginAt: Date,
  },
  {
    timestamps: true,
  },
);

// Indexes
userSchema.index({ "subscription.plan": 1 });
userSchema.index({ isEmailVerified: 1, accountStatus: 1 });
userSchema.index({ "security.lockUntil": 1 }, { sparse: true });

// Virtual: Check if user has credits
userSchema.virtual("hasCredits").get(function () {
  return this.subscription.plan === "pro" || this.subscription.credits > 0;
});

// Virtual: Check if account is locked
userSchema.virtual("isLocked").get(function () {
  return this.security.lockUntil && this.security.lockUntil > Date.now();
});

// Pre-save hook: Hash password
userSchema.pre("save", async function () {
  if (!this.isModified("password")) return;

  const salt = await genSalt(10);
  this.password = await hash(this.password, salt);
});

// Pre-save hook: Set billing date for new free users
userSchema.pre("save", function () {
  if (this.isNew && this.subscription.plan === "free") {
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    this.subscription.nextBillingDate = nextMonth;
  }
});

// Method: Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await compare(candidatePassword, this.password);
};

// Method: Deduct credit
userSchema.methods.deductCredit = async function () {
  if (this.subscription.plan === "free") {
    if (this.subscription.credits <= 0) {
      throw new Error("Out of credits");
    }
    this.subscription.credits -= 1;
    await this.save();
  }
  // Pro users: unlimited, no deduction
};

// Method: Increment failed login attempts
userSchema.methods.incrementLoginAttempts = async function () {
  // Lock after 5 failed attempts for 15 minutes
  if (this.security.failedLoginAttempts + 1 >= 5) {
    this.security.lockUntil = new Date(Date.now() + 15 * 60 * 1000);
    this.accountStatus = "locked";
  }
  this.security.failedLoginAttempts += 1;
  await this.save();
};

// Method: Reset login attempts (after successful login)
userSchema.methods.resetLoginAttempts = async function () {
  if (
    this.security.failedLoginAttempts > 0 ||
    this.security.lockUntil ||
    this.accountStatus === "locked"
  ) {
    this.security.failedLoginAttempts = 0;
    this.security.lockUntil = null;
    if (this.accountStatus === "locked") {
      this.accountStatus = "active";
    }
    await this.save();
  }
};

// Method: Check if can login (not locked)
userSchema.methods.canLogin = function () {
  // Check if lock has expired
  if (this.security.lockUntil && this.security.lockUntil <= Date.now()) {
    return true; // Lock expired
  }
  return !this.isLocked;
};

// Method: Get remaining lock time in seconds
userSchema.methods.getRemainingLockTime = function () {
  if (!this.security.lockUntil) return 0;
  const remaining = this.security.lockUntil.getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
};

// Method: Add refresh token (hashed)
userSchema.methods.addRefreshToken = async function (token, userAgent, ip) {
  const salt = await genSalt(10);
  const hashedToken = await hash(token, salt);

  this.refreshTokens.push({
    token: hashedToken,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    userAgent,
    ip,
  });

  // Keep only last 5 tokens per user
  if (this.refreshTokens.length > 5) {
    this.refreshTokens = this.refreshTokens.slice(-5);
  }

  await this.save();
};

// Method: Verify and remove refresh token
userSchema.methods.verifyRefreshToken = async function (token) {
  // Remove expired tokens first
  this.refreshTokens = this.refreshTokens.filter(
    (rt) => rt.expiresAt > new Date(),
  );

  for (let i = 0; i < this.refreshTokens.length; i++) {
    const isValid = await compare(token, this.refreshTokens[i].token);
    if (isValid) {
      // Remove used token (single use / rotation)
      this.refreshTokens.splice(i, 1);
      await this.save();
      return true;
    }
  }
  return false;
};

// Method: Invalidate all refresh tokens (on password change/reset)
userSchema.methods.invalidateAllRefreshTokens = async function () {
  this.refreshTokens = [];
  this.security.passwordChangedAt = new Date();
  await this.save();
};

// Method: Activate account (after email verification)
userSchema.methods.activateAccount = async function () {
  this.isEmailVerified = true;
  this.accountStatus = "active";
  await this.save();
};

// Method: Upgrade to Pro
userSchema.methods.upgradeToPro = async function (
  plan,
  paymentIntentId = null,
) {
  this.subscription.plan = "pro";
  this.subscription.status = "active";
  this.subscription.startDate = new Date();

  if (plan === "pro_monthly") {
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);
    this.subscription.endDate = endDate;
    this.subscription.nextBillingDate = endDate;
  } else if (plan === "pro_yearly") {
    const endDate = new Date();
    endDate.setFullYear(endDate.getFullYear() + 1);
    this.subscription.endDate = endDate;
    this.subscription.nextBillingDate = endDate;
  } else {
    // Fallback: nếu plan không rõ ràng → mặc định +1 tháng
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 1);
    this.subscription.endDate = endDate;
    this.subscription.nextBillingDate = endDate;
  }

  if (paymentIntentId) {
    this.subscription.lastPaymentId = paymentIntentId;
  }

  await this.save();
};

// Method: Add credits
userSchema.methods.addCredits = async function (amount) {
  this.subscription.credits += amount;
  await this.save();
};

// Static: Find by email for login (includes check for verified)
userSchema.statics.findForLogin = function (email) {
  return this.findOne({
    email: email.toLowerCase(),
  });
};

export default model("User", userSchema);
