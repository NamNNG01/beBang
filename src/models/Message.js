import { Schema, model } from "mongoose";

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },

    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    senderRole: {
      type: String,
      enum: ["user", "support", "admin"],
      required: true,
    },

    content: {
      type: String,
      required: true,
    },

    attachments: {
      type: [String],
      default: [],
    },

    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },

    readAt: Date,
  },
  {
    timestamps: true,
  }
);

// Compound index for loading messages in order
messageSchema.index({ conversationId: 1, createdAt: 1 });

export default model("Message", messageSchema);
