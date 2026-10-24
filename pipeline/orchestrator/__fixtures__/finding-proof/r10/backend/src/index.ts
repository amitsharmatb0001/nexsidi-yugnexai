import "dotenv/config";
import app from "./app";
import { seedStaff } from "./db/seedStaff";

const port = Number(process.env.PORT) || 3001;

// Ensure JWT_SECRET is present, otherwise fail fast
if (!process.env.JWT_SECRET) {
  console.error("CRITICAL CONFIG ERROR: JWT_SECRET environment variable is not set!");
  process.exit(1);
}

// Seed default staff account
seedStaff().then(() => {
  app.listen(port, () => {
    console.log(`[backend] listening on :${port}`);
  });
});
