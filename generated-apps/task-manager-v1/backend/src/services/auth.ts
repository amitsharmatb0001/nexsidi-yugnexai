import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export interface AuthUser {
  id: string;
  clerk_id: string;
  email: string;
  created_at: Date;
  updated_at: Date;
}

export async function getUserByClerkId(clerkId: string): Promise<AuthUser | null> {
  const result = await pool.query(
    'SELECT id, clerk_id, email, created_at, updated_at FROM users WHERE clerk_id = $1',
    [clerkId]
  );
  
  return result.rows.length > 0 ? result.rows[0] : null;
}

export async function createUser(clerkId: string, email: string): Promise<AuthUser> {
  const result = await pool.query(
    'INSERT INTO users (clerk_id, email, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING id, clerk_id, email, created_at, updated_at',
    [clerkId, email]
  );
  
  return result.rows[0];
}

export async function syncUser(clerkId: string, email: string): Promise<AuthUser> {
  const existing = await getUserByClerkId(clerkId);
  
  if (existing) {
    await pool.query(
      'UPDATE users SET email = $1, updated_at = NOW() WHERE clerk_id = $2 RETURNING id, clerk_id, email, created_at, updated_at',
      [email, clerkId]
    );
    return existing;
  }
  
  return await createUser(clerkId, email);
}
