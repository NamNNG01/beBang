import { Schema, model } from "mongoose";

const webhookLogSchema = new Schema(
  {
    provider: {
      type: String,
      default: "casso",
      index: true,
    },

    headers: {
      type: Schema.Types.Mixed,
    },

    body: {
      type: Schema.Types.Mixed,
    },

    signatureStatus: {
      type: String,
      enum: ["verified", "invalid", "skipped"],
      default: "skipped",
      index: true,
    },

    processingStatus: {
      type: String,
      enum: ["pending", "processed", "failed", "unmatched"],
      default: "pending",
      index: true,
    },

    results: {
      type: Schema.Types.Mixed,
    },

    error: {
      type: String,
    },

    responseTime: {
      type: Number, // in ms
    },

    ip: String,
  },
  {
    timestamps: true,
  }
);

// TTL: Auto delete after 90 days to save space
webhookLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

export default model("WebhookLog", webhookLogSchema);
