import { Schema, model } from "mongoose";
import { genSalt, hash, compare } from "bcryptjs";

const otpTokenSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null, // null for signup, set for reset password
      index: true,
    },

    otpHash: {
      type: String,
      required: true,
    },

    purpose: {
      type: String,
      enum: ["signup", "reset_password", "change_email"],
      required: true,
      index: true,
    },

    attempts: {
      type: Number,
      default: 0,
      max: 5, // lock after 5 failed attempts
    },

    resendCount: {
      type: Number,
      default: 0,
      max: 3, // max 3 resends per OTP session
    },

    lastSentAt: {
      type: Date,
      default: Date.now,
    },

    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 min
    },

    consumedAt: {
      type: Date,
      default: null,
    },

    isConsumed: {
      type: Boolean,
      default: false,
      index: true,
    },

    metadata: {
      ip: String,
      userAgent: String,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
otpTokenSchema.index({ email: 1, purpose: 1, isConsumed: 1 });
otpTokenSchema.index({ userId: 1, purpose: 1, isConsumed: 1 });

// TTL index: auto delete 1 hour after expiry
otpTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

// Static: Generate and save OTP
otpTokenSchema.statics.generateOTP = async function (
  email,
  purpose,
  userId = null,
  metadata = {}
) {
  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Hash OTP
  const salt = await genSalt(10);
  const otpHash = await hash(otp, salt);

  // Invalidate previous OTPs for this email + purpose
  await this.updateMany(
    { email, purpose, isConsumed: false },
    { isConsumed: true, consumedAt: new Date() }
  );

  // Create new OTP token
  const otpToken = await this.create({
    email,
    userId,
    otpHash,
    purpose,
    metadata,
  });

  return { otp, otpToken }; // Return plain OTP to send via email
};

// Static: Find active OTP for email
otpTokenSchema.statics.findActiveOTP = function (email, purpose) {
  return this.findOne({
    email,
    purpose,
    isConsumed: false,
    expiresAt: { $gt: new Date() },
  });
};

// Static: Check rate limit for email
otpTokenSchema.statics.checkRateLimit = async function (email, purpose) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const count = await this.countDocuments({
    email,
    purpose,
    createdAt: { $gt: oneHourAgo },
  });
  return count < 10; // Max 10 OTPs per hour (increased for easier testing)
};

// Instance: Verify OTP
otpTokenSchema.methods.verifyOTP = async function (otp) {
  // Check if expired
  if (this.expiresAt < new Date()) {
    throw new Error("OTP_EXPIRED");
  }

  // Check if consumed
  if (this.isConsumed) {
    throw new Error("OTP_ALREADY_USED");
  }

  // Check attempts
  if (this.attempts >= 5) {
    throw new Error("OTP_MAX_ATTEMPTS");
  }

  // Verify OTP
  const isValid = await compare(otp, this.otpHash);

  if (!isValid) {
    this.attempts += 1;
    await this.save();
    throw new Error("OTP_INVALID");
  }

  // Mark as consumed
  this.isConsumed = true;
  this.consumedAt = new Date();
  await this.save();

  return true;
};

// Instance: Check if can resend
otpTokenSchema.methods.canResend = function () {
  const cooldown = 60 * 1000; // 60 seconds
  const timeSinceLastSent = Date.now() - this.lastSentAt.getTime();
  return timeSinceLastSent >= cooldown && this.resendCount < 3;
};

// Instance: Get remaining cooldown in seconds
otpTokenSchema.methods.getRemainingCooldown = function () {
  const cooldown = 60 * 1000;
  const timeSinceLastSent = Date.now() - this.lastSentAt.getTime();
  const remaining = Math.max(0, cooldown - timeSinceLastSent);
  return Math.ceil(remaining / 1000);
};

// Instance: Increment resend count and update lastSentAt
otpTokenSchema.methods.markResent = async function () {
  this.resendCount += 1;
  this.lastSentAt = new Date();
  await this.save();
};

export default model("OTPToken", otpTokenSchema);
