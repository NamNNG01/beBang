import { Router } from "express";
import {
  registerUser,
  loginUser,
  logoutUser,
  getProfile,
  getCredits,
  updateProfile,
} from "../controllers/user.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";

const router = Router();

// Routes công khai (không cần đăng nhập)
router.post("/register", registerUser);
router.post("/login", loginUser);

// Routes cần đăng nhập
router.post("/logout", authenticate, logoutUser);
router.get("/profile", authenticate, getProfile);
router.put("/profile", authenticate, updateProfile);
router.get("/credits", authenticate, getCredits);

export default router;
