import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";

// Tạo conversation mới (user tạo ticket hỗ trợ)
export const createConversation = async (req, res) => {
  try {
    const { subject, message } = req.body;
    const userId = req.user._id;

    if (!message) {
      return res.status(400).json({ message: "Thiếu nội dung tin nhắn" });
    }

    // Tạo conversation
    const conversation = await Conversation.create({
      userId,
      subject: subject || "Support Request",
      lastMessage: message,
      lastMessageAt: new Date(),
      unreadCountAgent: 1,
    });

    // Tạo tin nhắn đầu tiên
    await Message.create({
      conversationId: conversation._id,
      senderId: userId,
      senderRole: "user",
      content: message,
    });

    res.status(201).json({
      message: "Đã tạo yêu cầu hỗ trợ",
      conversation,
    });
  } catch (error) {
    console.error("Lỗi tạo conversation:", error);
    res.status(500).json({ message: "Lỗi tạo yêu cầu hỗ trợ" });
  }
};

// Lấy danh sách conversations của user
export const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status } = req.query;

    const query = { userId };
    if (status) query.status = status;

    const conversations = await Conversation.find(query)
      .sort({ lastMessageAt: -1 })
      .populate("supportAgentId", "name email");

    res.status(200).json(conversations);
  } catch (error) {
    console.error("Lỗi lấy conversations:", error);
    res.status(500).json({ message: "Lỗi lấy danh sách hỗ trợ" });
  }
};

// Lấy chi tiết conversation với messages
export const getConversationDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const conversation = await Conversation.findOne({
      _id: id,
      userId,
    }).populate("supportAgentId", "name email");

    if (!conversation) {
      return res.status(404).json({ message: "Không tìm thấy conversation" });
    }

    // Lấy messages
    const messages = await Message.find({ conversationId: id })
      .sort({ createdAt: 1 })
      .populate("senderId", "name avatar");

    // Đánh dấu đã đọc
    await Message.updateMany(
      { conversationId: id, senderRole: { $ne: "user" }, isRead: false },
      { isRead: true, readAt: new Date() }
    );
    conversation.unreadCountUser = 0;
    await conversation.save();

    res.status(200).json({ conversation, messages });
  } catch (error) {
    console.error("Lỗi lấy chi tiết conversation:", error);
    res.status(500).json({ message: "Lỗi lấy chi tiết" });
  }
};

// Gửi tin nhắn trong conversation
export const sendMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const user = req.user;

    if (!content) {
      return res.status(400).json({ message: "Thiếu nội dung tin nhắn" });
    }

    // Kiểm tra conversation tồn tại
    const conversation = await Conversation.findOne({
      _id: id,
      $or: [{ userId: user._id }, { supportAgentId: user._id }],
    });

    if (!conversation) {
      return res.status(404).json({ message: "Không tìm thấy conversation" });
    }

    // Xác định role
    const senderRole = user.role === "user" ? "user" : user.role;

    // Tạo message
    const message = await Message.create({
      conversationId: id,
      senderId: user._id,
      senderRole,
      content,
    });

    // Cập nhật conversation
    conversation.lastMessage = content;
    conversation.lastMessageAt = new Date();
    if (senderRole === "user") {
      conversation.unreadCountAgent += 1;
    } else {
      conversation.unreadCountUser += 1;
    }
    await conversation.save();

    res.status(201).json(message);
  } catch (error) {
    console.error("Lỗi gửi tin nhắn:", error);
    res.status(500).json({ message: "Lỗi gửi tin nhắn" });
  }
};
