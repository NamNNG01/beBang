import { Schema, model } from "mongoose";
import crypto from "crypto";

const aiHistorySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    type: {
      type: String,
      enum: ["formula", "analysis", "guide", "vba", "chart"],
      required: true,
      index: true,
    },

    input: {
      prompt: {
        type: String,
        required: true,
      },
      excelContext: {
        type: Schema.Types.Mixed,
        default: null,
      },
      contextHash: {
        type: String,
        index: true,
      },
    },

    output: {
      result: {
        type: Schema.Types.Mixed,
        required: true,
      },
      tokensUsed: Number,
      latency: Number, // ms
    },

    isCached: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Compound indexes
aiHistorySchema.index({ userId: 1, type: 1, createdAt: -1 });

// TTL index: auto-delete records older than 90 days
aiHistorySchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

// Pre-save hook: Generate contextHash
aiHistorySchema.pre("save", function () {
  if (this.input.prompt && !this.input.contextHash) {
    const hashInput = JSON.stringify({
      prompt: this.input.prompt,
      type: this.type,
      context: this.input.excelContext,
    });
    this.input.contextHash = crypto
      .createHash("md5")
      .update(hashInput)
      .digest("hex");
  }
});

// Static method: Find cached result
aiHistorySchema.statics.findCached = async function (
  type,
  prompt,
  excelContext,
) {
  const hashInput = JSON.stringify({ prompt, type, context: excelContext });
  const hash = crypto.createHash("md5").update(hashInput).digest("hex");

  // Different TTL for different types
  let cacheDuration;
  if (type === "analysis") {
    cacheDuration = 5 * 60 * 1000; // 5 minutes - data changes frequently
  } else if (type === "formula") {
    cacheDuration = 60 * 60 * 1000; // 1 hour - formulas are stable
  } else {
    cacheDuration = 30 * 60 * 1000; // 30 minutes - guides are semi-stable
  }

  const cacheExpiry = new Date(Date.now() - cacheDuration);

  return await this.findOne({
    "input.contextHash": hash,
    type,
    createdAt: { $gte: cacheExpiry },
  });
};

export default model("AIHistory", aiHistorySchema);
