import "dotenv/config.js";
import mongoose from "mongoose";
import User from "./src/models/User.js";

async function main() {
  const mongoUri =
    process.env.MONGODB_URI ||
    "mongodb+srv://minhto1511:Minh2004@clutch.ox9s5q9.mongodb.net/eofficeai?appName=clutch";

  await mongoose.connect(mongoUri);
  const freeUser = await User.findOne({ "subscription.plan": "free" });
  if (freeUser) {
    console.log("Found free user:", freeUser.email);
  } else {
    console.log("No free user found.");
  }
  await mongoose.disconnect();
}

main();
