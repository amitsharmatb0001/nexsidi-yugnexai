import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function createUser(clerkId: string) {
  const email = clerkId + "@example.com";
  const createdAt = new Date();
  const updatedAt = createdAt;

  await pool.query(
    `
      INSERT INTO users (clerk_id, email, created_at, updated_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [clerkId, email, createdAt, updatedAt]
  );

  const result = await pool.query(
    `
      SELECT * FROM users WHERE clerk_id = $1
    `,
    [clerkId]
  );
  return result.rows[0].id;
}