/**
 * Migration: Add email verification fields to existing users
 *
 * Run this migration to update existing users with new fields:
 * - isEmailVerified: true (they registered before OTP was required)
 * - accountStatus: 'active'
 * - security: default values
 * - subscription.status: 'active'
 *
 * Usage:
 *   node src/migrations/001_email_verification.js
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI =
  process.env.MONGO_URI || "mongodb://localhost:27017/eofficeai";

async function runMigration() {
  try {
    console.log("Connecting to MongoDB...");
    await mongoose.connect(MONGO_URI);
    console.log("Connected to MongoDB");

    const User = mongoose.connection.collection("users");

    // Count users before migration
    const totalUsers = await User.countDocuments();
    console.log(`Total users in database: ${totalUsers}`);

    // Update all existing users
    const result = await User.updateMany(
      {
        // Only update users that don't have the new fields
        $or: [
          { accountStatus: { $exists: false } },
          { isEmailVerified: { $exists: false } },
          { security: { $exists: false } },
        ],
      },
      {
        $set: {
          // Mark existing users as verified (they registered before OTP)
          isEmailVerified: true,
          accountStatus: "active",

          // Initialize security fields
          security: {
            failedLoginAttempts: 0,
            lockUntil: null,
            passwordChangedAt: new Date(),
            lastPasswordResetAt: null,
          },

          // Initialize refresh tokens array
          refreshTokens: [],

          // Ensure subscription has status
          "subscription.status": "active",
        },
      }
    );

    console.log(`Migration complete!`);
    console.log(`  - Matched: ${result.matchedCount} users`);
    console.log(`  - Modified: ${result.modifiedCount} users`);

    // Verify migration
    const verifiedCount = await User.countDocuments({
      isEmailVerified: true,
      accountStatus: "active",
    });
    console.log(`  - Verified users: ${verifiedCount}`);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB");
  }
}

// Run migration
runMigration();
