import { Schema, model } from "mongoose";
import crypto from "crypto";

const paymentIntentSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    plan: {
      type: String,
      enum: ["pro_monthly", "pro_yearly", "credits_50", "credits_100"],
      required: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      enum: ["VND", "USD"],
      default: "VND",
    },

    transferCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    status: {
      type: String,
      enum: [
        "pending",
        "paid",
        "expired",
        "failed",
        "underpaid",
        "overpaid",
        "cancelled",
      ],
      default: "pending",
      index: true,
    },

    provider: {
      type: String,
      enum: ["vietqr_casso", "vnpay", "momo", "manual"],
      default: "vietqr_casso",
    },

    // QR payload
    qrData: {
      bankCode: String,
      accountNumber: String,
      accountName: String,
      amount: Number,
      description: String, // contains transferCode
      qrCodeUrl: String,
    },

    expiresAt: {
      type: Date,
      required: true,
      default: () => new Date(Date.now() + 5 * 60 * 1000), // 5 min
    },

    paidAt: Date,
    cancelledAt: Date,

    // Related transaction
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentTransaction",
      default: null,
    },

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes
paymentIntentSchema.index({ userId: 1, status: 1, createdAt: -1 });
paymentIntentSchema.index({ transferCode: 1, status: 1 });

// TTL index: auto delete expired intents after 24h
paymentIntentSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 24 * 60 * 60 },
);

// Plan pricing map (VND)
const PRICING_MAP = {
  pro_monthly: 49000,
  pro_yearly: 470000,
  credits_50: 20000, // Added based on context, though not explicitly asked, good to have complete map if used elsewhere
  credits_100: 35000,
};

// Static: Generate unique transfer code
paymentIntentSchema.statics.generateTransferCode = async function () {
  let code;
  let exists = true;

  while (exists) {
    // Format: EOAI-XXXXXX (6 alphanumeric chars, uppercase)
    const randomPart = crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()
      .substring(0, 6);
    code = `EOAI-${randomPart}`;

    // Check uniqueness
    exists = await this.findOne({ transferCode: code });
  }

  return code;
};

// Static: Create payment intent
paymentIntentSchema.statics.createIntent = async function (
  userId,
  plan,
  provider = "vietqr_casso",
) {
  const amount = PRICING_MAP[plan];
  if (!amount) throw new Error("INVALID_PLAN");

  const transferCode = await this.generateTransferCode();

  const bankCode = process.env.BANK_CODE || "VCB";
  const accountNumber = process.env.BANK_ACCOUNT_NUMBER || "";
  const accountName = process.env.BANK_ACCOUNT_NAME || "BangAI";

  // Create intent
  const intent = await this.create({
    userId,
    plan,
    amount,
    currency: "VND",
    transferCode,
    provider,
    qrData: {
      bankCode,
      accountNumber,
      accountName,
      amount,
      description: `${transferCode} BangAI ${plan}`,
    },
  });

  return intent;
};

// Static: Parse transfer code from description
paymentIntentSchema.statics.parseTransferCode = function (description) {
  if (!description) return null;
  // Regex: Matches EOAI-XXXXXX or EOAIXXXXXX (with or without dash)
  // Captures the 6 alphanumeric characters after EOAI
  const regex = /EOAI-?([A-Z0-9]{6})/i;
  const match = description.match(regex);
  if (match) {
    // Normalize to standard format: EOAI-XXXXXX
    return `EOAI-${match[1].toUpperCase()}`;
  }
  return null;
};

// Static: Get plan pricing
paymentIntentSchema.statics.getPricing = function () {
  return PRICING_MAP;
};

// Instance: Generate VietQR URL
paymentIntentSchema.methods.generateQRUrl = function () {
  const { bankCode, accountNumber, amount, description, accountName } =
    this.qrData;

  // VietQR API format
  const qrUrl = `https://img.vietqr.io/image/${bankCode}-${accountNumber}-compact.png?amount=${amount}&addInfo=${encodeURIComponent(
    description,
  )}&accountName=${encodeURIComponent(accountName)}`;

  return qrUrl;
};

// Instance: Mark as paid
paymentIntentSchema.methods.markAsPaid = async function (transactionId) {
  this.status = "paid";
  this.paidAt = new Date();
  this.transactionId = transactionId;
  await this.save();
};

// Instance: Check if expired
paymentIntentSchema.methods.isExpired = function () {
  return this.expiresAt < new Date();
};

// Instance: Get status for client
paymentIntentSchema.methods.getClientStatus = function () {
  // Auto-update status if expired
  if (this.status === "pending" && this.isExpired()) {
    return "expired";
  }
  return this.status;
};

// Instance: Get remaining time in seconds
paymentIntentSchema.methods.getRemainingTime = function () {
  const remaining = this.expiresAt.getTime() - Date.now();
  return Math.max(0, Math.ceil(remaining / 1000));
};

export default model("PaymentIntent", paymentIntentSchema);
