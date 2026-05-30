// BE/scripts/delete-seeded-free-users.js
// Xóa 262 user đã seed (email: free_user_1@example.com ... free_user_262@example.com)
import "dotenv/config.js";
import mongoose from "mongoose";
import User from "../src/models/User.js";

async function main() {
  const mongoUri =
    process.env.MONGODB_URI ||
    "mongodb+srv://minhto1511:Minh2004@clutch.ox9s5q9.mongodb.net/eofficeai?appName=clutch";

  console.log("Connecting to Mongo...");
  await mongoose.connect(mongoUri);

  const result = await User.deleteMany({
    email: /^free_user_\d+@example\.com$/,
  });

  console.log(`Deleted ${result.deletedCount} users (free_user_*@example.com)`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Delete error:", err);
  process.exit(1);
});
