// BE/scripts/seed-pro-users.js
import "dotenv/config.js";
import mongoose from "mongoose";
import User from "../src/models/User.js";

async function main() {
  const mongoUri =
    process.env.MONGODB_URI ||
    "mongodb+srv://minhto1511:Minh2004@clutch.ox9s5q9.mongodb.net/eofficeai?appName=clutch";

  console.log("Connecting to Mongo:", mongoUri);
  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    const now = new Date();
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1); // Expiry in 1 year

    for (let i = 1; i <= 11; i++) {
        const email = `pro_user_${i}@example.com`;
        const userData = {
            email: email,
            password: "ProUser123!", 
            name: `User Pro ${i}`,
            isEmailVerified: true,
            accountStatus: "active",
            subscription: {
                plan: "pro",
                status: "active",
                credits: 9999,
                startDate: now,
                endDate: expiryDate,
                nextBillingDate: expiryDate
            }
        };

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log(`User ${email} already exists, updating to Pro...`);
            existingUser.subscription.plan = "pro";
            existingUser.subscription.status = "active";
            existingUser.subscription.endDate = expiryDate;
            existingUser.isEmailVerified = true;
            existingUser.accountStatus = "active";
            await existingUser.save();
        } else {
            const newUser = new User(userData);
            await newUser.save();
            console.log(`Created new pro user: ${email}`);
        }
    }

    console.log(`Successfully managed 11 pro users.`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error("Seed error:", err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
