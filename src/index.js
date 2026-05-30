import dotenv from "dotenv"; //dotenv dùng để đọc file .env và nạp biến môi trường vào process.env
import connectDB from "./config/database.js";
import app from "./app.js"; //import app từ file app.js

dotenv.config({
  path: "./.env",
});

const startServer = async () => {
  try {
    console.log("=== STARTING SERVER ===");
    console.log("PORT:", process.env.PORT);
    console.log("MONGODB_URI:", process.env.MONGODB_URI);
    console.log("JWT_SECRET exists:", !!process.env.JWT_SECRET);

    console.log("Connecting to MongoDB...");
    await connectDB();
    console.log("MongoDB connected successfully!");

    // [AUTO-FIX] Fix PRO users thiếu endDate (chạy 1 lần khi khởi động)
    try {
      const User = (await import("./models/User.js")).default;
      const defaultEndDate = new Date();
      defaultEndDate.setMonth(defaultEndDate.getMonth() + 1);

      const result = await User.updateMany(
        {
          "subscription.plan": "pro",
          $or: [
            { "subscription.endDate": null },
            { "subscription.endDate": { $exists: false } },
          ],
        },
        {
          $set: {
            "subscription.endDate": defaultEndDate,
            "subscription.nextBillingDate": defaultEndDate,
          },
        },
      );
      if (result.modifiedCount > 0) {
        console.log(
          `[AUTO-FIX] Fixed ${result.modifiedCount} PRO users missing endDate (set to ${defaultEndDate.toISOString()})`,
        );
      }
    } catch (fixErr) {
      console.error("[AUTO-FIX] Failed:", fixErr.message);
    }

    app.on("error", (error) => {
      console.error("=== APP ERROR ===");
      console.error("Error:", error);
      console.error("Stack:", error.stack);
      throw error;
    });

    const PORT = process.env.PORT || 5000;
    console.log(`Attempting to listen on port ${PORT}...`);

    const server = app.listen(PORT, () => {
      console.log("=== SERVER STARTED SUCCESSFULLY ===");
      console.log(`Server is running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
      console.log(`API Base: http://localhost:${PORT}/api/v1`);
    });

    server.on("error", (error) => {
      console.error("=== SERVER ERROR ===");
      console.error("Error:", error);
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use!`);
      }
    });
  } catch (error) {
    console.error("=== STARTUP ERROR ===");
    console.error("MongoDB connection failed:", error);
    console.error("Stack:", error.stack);
    process.exit(1);
  }
};

startServer();
