import { Schema, model } from "mongoose";

const auditLogSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null, // null for failed login attempts with unknown user
      index: true,
    },

    action: {
      type: String,
      required: true,
      enum: [
        "login",
        "logout",
        "login_failed",
        "signup",
        "email_verified",
        "password_changed",
        "password_reset_requested",
        "password_reset_completed",
        "otp_sent",
        "otp_verified",
        "otp_failed",
        "payment_intent_created",
        "payment_completed",
        "plan_upgraded",
        "account_locked",
        "account_unlocked",
        "admin_manual_match",
        "admin_user_upgrade",
        "admin_config_change",
      ],
      index: true,
    },

    ip: {
      type: String,
      default: null,
    },

    userAgent: {
      type: String,
      default: null,
    },

    email: {
      type: String,
      default: null, // For tracking attempts with unknown users
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },

    status: {
      type: String,
      enum: ["success", "failed"],
      default: "success",
    },

    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
auditLogSchema.index({ userId: 1, action: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });
auditLogSchema.index({ email: 1, timestamp: -1 });

// TTL: auto delete after 1 year
auditLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 }
);

// Static: Log an action
auditLogSchema.statics.log = async function (action, data = {}) {
  try {
    await this.create({
      action,
      userId: data.userId || null,
      email: data.email || null,
      ip: data.ip || null,
      userAgent: data.userAgent || null,
      status: data.status || "success",
      metadata: data.metadata || {},
    });
  } catch (error) {
    console.error("AuditLog error:", error);
    // Don't throw - audit logging should not break main flow
  }
};

// Static: Get recent actions for user
auditLogSchema.statics.getUserHistory = function (userId, limit = 50) {
  return this.find({ userId }).sort({ timestamp: -1 }).limit(limit);
};

// Static: Get failed login attempts for email in last hour
auditLogSchema.statics.getRecentFailedLogins = function (email) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  return this.countDocuments({
    email,
    action: "login_failed",
    timestamp: { $gt: oneHourAgo },
  });
};

export default model("AuditLog", auditLogSchema);
