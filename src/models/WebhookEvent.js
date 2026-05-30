import { Schema, model } from "mongoose";

const webhookEventSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ["casso", "vnpay", "momo"],
      required: true,
      index: true,
    },

    eventId: {
      type: String,
      required: true,
      unique: true, // Idempotency
    },

    eventType: {
      type: String, // 'transaction', 'refund', etc.
      default: "transaction",
    },

    rawPayload: {
      type: Schema.Types.Mixed,
      required: true,
    },

    signature: String,

    signatureValid: {
      type: Boolean,
      default: false,
    },

    processed: {
      type: Boolean,

      default: false,
      index: true,
    },

    processedAt: Date,

    error: String,

    relatedTransactionId: {
      type: Schema.Types.ObjectId,
      ref: "PaymentTransaction",
    },
  },
  {
    timestamps: true,
  },
);

// Compound index
webhookEventSchema.index({ provider: 1, processed: 1, createdAt: -1 });

// TTL: auto delete after 90 days
webhookEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

// Static: Check if event already processed (idempotency)
webhookEventSchema.statics.isProcessed = async function (eventId) {
  const existing = await this.findOne({ eventId });
  return existing ? existing.processed : false;
};

// Static: Create event
webhookEventSchema.statics.createEvent = async function (
  provider,
  eventId,
  rawPayload,
  signature = null,
) {
  // Check if already exists
  const existing = await this.findOne({ eventId });
  if (existing) {
    return { event: existing, alreadyExists: true };
  }

  const event = await this.create({
    provider,
    eventId,
    rawPayload,
    signature,
    signatureValid: false, // Will be set after verification
  });

  return { event, alreadyExists: false };
};

// Instance: Mark as processed
webhookEventSchema.methods.markProcessed = async function (
  transactionId = null,
  error = null,
) {
  this.processed = true;
  this.processedAt = new Date();
  if (transactionId) {
    this.relatedTransactionId = transactionId;
  }
  if (error) {
    this.error = error;
  }
  await this.save();
};

// Instance: Mark signature as valid
webhookEventSchema.methods.setSignatureValid = async function (isValid) {
  this.signatureValid = isValid;
  await this.save();
};

export default model("WebhookEvent", webhookEventSchema);
