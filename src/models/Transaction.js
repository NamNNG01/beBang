import { Schema, model } from "mongoose";

const transactionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
    },

    currency: {
      type: String,
      default: "USD",
      enum: ["USD", "VND"],
    },

    type: {
      type: String,
      required: true,
      enum: ["upgrade_pro", "refill_credits"],
    },

    packageId: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed", "refunded"],
      default: "pending",
      index: true,
    },

    paymentGateway: {
      type: String,
      enum: ["stripe", "paypal", "vnpay"],
    },

    gatewayTransactionId: String,

    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for user history queries
transactionSchema.index({ userId: 1, createdAt: -1 });

export default model("Transaction", transactionSchema);
