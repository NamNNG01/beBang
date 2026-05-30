import User from "../models/User.js";
import jwt from "jsonwebtoken";

const registerUser = async (req, res) => {
  try {
    const { email, password, name } = req.body;

    // Kiểm tra thiếu thông tin
    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập đầy đủ thông tin" });
    }

    // Validate mật khẩu: tối thiểu 8 ký tự và có ít nhất 1 chữ hoa
    if (password.length < 8) {
      return res
        .status(400)
        .json({ message: "Mật khẩu phải có ít nhất 8 ký tự" });
    }

    if (!/[A-Z]/.test(password)) {
      return res
        .status(400)
        .json({ message: "Mật khẩu phải chứa ít nhất 1 chữ hoa" });
    }

    const user = await User.create({ email, password, name });

    res.status(201).json(user);
  } catch (error) {
    console.error("Lỗi đăng kí người dùng:", error);
    res.status(500).json({ message: "Lỗi đăng kí người dùng" });
  }
};

const loginUser = async (req, res) => {
  try {
    console.log("=== LOGIN REQUEST RECEIVED ===");
    console.log("Request body:", req.body);

    const { email, password } = req.body;
    console.log("Email:", email);
    console.log("Password length:", password?.length);

    // Tìm user trong database
    console.log("Finding user in database...");
    const user = await User.findOne({
      email: email.toLowerCase(),
    });

    if (!user) {
      console.log("User not found!");
      return res.status(401).json({ message: "User không tồn tại" });
    }
    console.log("User found:", user.email);

    // So sánh mật khẩu
    console.log("Comparing password...");
    const isMatch = await user.comparePassword(password);
    console.log("Password match:", isMatch);

    if (!isMatch) {
      console.log("Password mismatch!");
      return res.status(401).json({ message: "Sai mật khẩu" });
    }

    // Tạo JWT token
    console.log("Creating JWT token...");
    console.log("JWT_SECRET exists:", !!process.env.JWT_SECRET);
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    console.log("Token created successfully");

    // Cập nhật thời gian đăng nhập cuối
    console.log("Updating lastLoginAt...");
    user.lastLoginAt = new Date();
    await user.save();
    console.log("User saved successfully");

    // Gửi response (CHỈ 1 LẦN DUY NHẤT)
    console.log("Sending success response...");
    res.status(200).json({
      message: "Người dùng đã đăng nhập thành công!",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
      token,
    });
    console.log("=== LOGIN SUCCESS ===");
  } catch (error) {
    console.error("=== LOGIN ERROR ===");
    console.error("Lỗi đăng nhập người dùng:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({ message: "Lỗi đăng nhập người dùng" });
  }
};

// Hàm logout (tách ra ngoài, KHÔNG lồng trong loginUser)
const logoutUser = async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "User không tồn tại" });
    }
    user.lastLoginAt = new Date();
    await user.save();
    res.status(200).json({ message: "User đã đăng xuất thành công" });
  } catch (error) {
    console.error("Lỗi đăng xuất người dùng:", error);
    res.status(500).json({ message: "Lỗi đăng xuất người dùng" });
  }
};

// Lấy thông tin profile (cần đăng nhập)
const getProfile = async (req, res) => {
  try {
    const user = req.user; // Đã được gắn từ middleware
    res.status(200).json({
      id: user._id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: user.role,
      subscription: user.subscription,
      isEmailVerified: user.isEmailVerified,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error("Lỗi lấy profile:", error);
    res.status(500).json({ message: "Lỗi lấy thông tin profile" });
  }
};

// Lấy thông tin credits còn lại
const getCredits = async (req, res) => {
  try {
    const user = req.user;
    res.status(200).json({
      plan: user.subscription.plan,
      credits: user.subscription.credits,
      hasCredits:
        user.subscription.plan === "pro" || user.subscription.credits > 0,
      startDate: user.subscription.startDate,
      endDate: user.subscription.endDate,
      nextBillingDate: user.subscription.nextBillingDate,
    });
  } catch (error) {
    console.error("Lỗi lấy credits:", error);
    res.status(500).json({ message: "Lỗi lấy thông tin credits" });
  }
};

// Cập nhật profile
const updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const user = req.user;

    if (name) user.name = name;
    if (avatar) user.avatar = avatar;
    await user.save();

    res.status(200).json({
      message: "Cập nhật thành công",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error("Lỗi cập nhật profile:", error);
    res.status(500).json({ message: "Lỗi cập nhật profile" });
  }
};

export {
  registerUser,
  loginUser,
  logoutUser,
  getProfile,
  getCredits,
  updateProfile,
};
