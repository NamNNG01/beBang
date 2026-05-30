import { Schema, model } from "mongoose";

const paymentTransactionSchema = new Schema(
  {
    providerTxId: {
      type: String,
      required: true,
      unique: true, // Idempotency key
      index: true,
    },

    intentId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentIntent",
      default: null,
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null, // null for unmatched transactions
      index: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "VND",
    },

    transferCode: {
      type: String,
      index: true,
    },

    description: {
      type: String, // raw description from bank
    },

    status: {
      type: String,
      enum: [
        "matched",
        "unmatched",
        "amount_mismatch",
        "manual_review",
        "refunded",
      ],
      default: "unmatched",
      index: true,
    },

    provider: {
      type: String,
      enum: ["vietqr_casso", "vietqr_sepay", "vnpay", "momo", "manual"],
      required: true,
    },

    rawPayload: {
      type: Schema.Types.Mixed, // store full webhook payload
    },

    receivedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    processedAt: Date,

    metadata: {
      bankCode: String,
      accountNumber: String,
      virtualAccount: String,
      senderName: String,
      senderAccount: String,
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes
paymentTransactionSchema.index({ userId: 1, status: 1, createdAt: -1 });
paymentTransactionSchema.index({ intentId: 1 }, { sparse: true });
paymentTransactionSchema.index({ status: 1, createdAt: -1 });

// Static: Check if transaction already processed (idempotency)
paymentTransactionSchema.statics.isProcessed = async function (providerTxId) {
  const existing = await this.findOne({ providerTxId });
  return !!existing;
};

// Static: Create from webhook
paymentTransactionSchema.statics.createFromWebhook = async function (data) {
  const {
    providerTxId,
    intentId,
    userId,
    amount,
    currency,
    transferCode,
    description,
    status,
    provider,
    rawPayload,
    metadata,
  } = data;

  return await this.create({
    providerTxId,
    intentId,
    userId,
    amount,
    currency: currency || "VND",
    transferCode,
    description,
    status: status || "unmatched",
    provider,
    rawPayload,
    receivedAt: new Date(),
    processedAt: status === "matched" ? new Date() : null,
    metadata: metadata || {},
  });
};

// Static: Get unmatched transactions for manual review
paymentTransactionSchema.statics.getUnmatched = function (limit = 50) {
  return this.find({
    status: { $in: ["unmatched", "amount_mismatch", "manual_review"] },
  })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Static: Get user payment history
paymentTransactionSchema.statics.getUserHistory = function (
  userId,
  limit = 20,
  skip = 0,
) {
  return this.find({ userId, status: "matched" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate("intentId", "plan amount transferCode");
};

export default model("PaymentTransaction", paymentTransactionSchema);
