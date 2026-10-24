import crypto from "crypto";
import bcrypt from "bcryptjs";
import { pool } from "./pool";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const seedStaff = async (retries = 5, delayMs = 1500): Promise<void> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const staffEmail = process.env.STAFF_EMAIL || "staff@brewline.com";
      let staffPassword = process.env.STAFF_PASSWORD;

      if (!staffPassword) {
        // Generate a strong random password to avoid exposed or hardcoded fallback secrets
        staffPassword = crypto.randomBytes(16).toString("hex");
        console.warn(`[seed] WARNING: STAFF_PASSWORD environment variable not set. Generated a strong random password for ${staffEmail}: ${staffPassword}`);
      }

      // Check if a staff/admin user already exists
      const result = await pool.query(
        "SELECT id FROM users WHERE role = 'staff' OR role = 'admin' LIMIT 1"
      );

      if (result.rows.length === 0) {
        const hashedPassword = await bcrypt.hash(staffPassword, 10);
        await pool.query(
          "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'staff')",
          [staffEmail, hashedPassword]
        );
        console.log(`[seed] Created default staff account: ${staffEmail}`);
      } else {
        console.log(`[seed] Staff/admin account already exists.`);
      }
      return; // Success, exit retry loop
    } catch (err: any) {
      console.error(
        `[seed] Attempt ${attempt}/${retries} failed: ${err.message || err}`
      );
      if (attempt === retries) {
        console.error("[seed] Max retries reached. Seeding failed permanently.");
        throw err;
      }
      await delay(delayMs);
    }
  }
};
