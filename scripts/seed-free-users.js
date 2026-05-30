// BE/scripts/seed-free-users.js
import dotenv from "dotenv";

dotenv.config({
    path: "../.env"
});
import mongoose from "mongoose";
import User from "../src/models/User.js";

async function main() {
    console.log(
        process.env.MONGODB_URI
    );

    await mongoose.connect(
        process.env.MONGODB_URI
    );

    console.log("Connected");

    for (let i = 278; i <= 280; i++) {

        const email =
            `free_user_${i}@example.com`;

        const existing =
            await User.findOne({ email });

        if (existing) {
            console.log(
                `${email} exists`
            );
            continue;
        }

        const user = new User({
            email,
            password: "FreeUser123!",
            name: `Free User ${i}`,
            isEmailVerified: true,
            accountStatus: "active",
            subscription: {
                plan: "free",
                status: "active",
                credits: 50
            }
        });

        // IMPORTANT:
        // save() => trigger pre-save bcrypt hook
        await user.save();

        console.log(
            `Created ${email}`
        );
    }

    console.log("Done");

    process.exit();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});