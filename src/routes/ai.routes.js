import { Router } from "express";
import {
  askAI,
  cancelAIRequest,
  getAIHistory,
  deleteAIHistory,
} from "../controllers/ai.controller.js";
import { authenticate, checkCredits } from "../middlewares/auth.middleware.js";

const router = Router();

// Tất cả routes đều cần đăng nhập
router.use(authenticate);

// Gọi AI (cần check credits)
router.post("/ask", checkCredits, askAI);

// Hủy request AI đang pending
router.post("/cancel/:requestId", cancelAIRequest);

// Lấy lịch sử
router.get("/history", getAIHistory);

// Xóa một mục lịch sử
router.delete("/history/:id", deleteAIHistory);

export default router;
