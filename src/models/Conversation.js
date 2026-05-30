import { Schema, model } from "mongoose";

const conversationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    supportAgentId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    status: {
      type: String,
      enum: ["open", "waiting", "resolved", "closed"],
      default: "open",
      index: true,
    },

    subject: {
      type: String,
      default: "Support Request",
    },

    lastMessage: String,

    lastMessageAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    unreadCountUser: {
      type: Number,
      default: 0,
    },

    unreadCountAgent: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for various queries
conversationSchema.index({ userId: 1, status: 1 });
conversationSchema.index({ supportAgentId: 1, status: 1 });

export default model("Conversation", conversationSchema);
