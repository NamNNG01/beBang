import { Router } from "express";
import {
  createConversation,
  getConversations,
  getConversationDetail,
  sendMessage,
} from "../controllers/conversation.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = Router();

// Tất cả routes đều cần đăng nhập
router.use(authenticate);

// Tạo conversation mới
router.post("/", createConversation);

// Lấy danh sách conversations
router.get("/", getConversations);

// Lấy chi tiết conversation + messages
router.get("/:id", getConversationDetail);

// Gửi tin nhắn trong conversation
router.post("/:id/messages", sendMessage);

export default router;
