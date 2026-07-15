import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@nexsidi/db/client";
import { sessions, users } from "@nexsidi/db/schema";
import { createSessionToken, hashSessionToken, SESSION_TTL_SECONDS } from "./session.ts";
import type { AuthService } from "../routes/auth.ts";

async function createSession(user: { id: string; email: string }) {
  const token = createSessionToken();
  await db.insert(sessions).values({ userId: user.id, tokenHash: hashSessionToken(token), expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) });
  return { user, token };
}

export const authService: AuthService = {
  async signUp(email, password) {
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) return null;
    const passwordHash = await Bun.password.hash(password, { algorithm: "argon2id" });
    try {
      const [user] = await db.insert(users).values({ email, passwordHash }).returning({ id: users.id, email: users.email });
      if (!user) throw new Error("user insert returned no record");
      return createSession(user);
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) return null;
      throw error;
    }
  },
  async signIn(email, password) {
    const [user] = await db.select({ id: users.id, email: users.email, passwordHash: users.passwordHash }).from(users).where(eq(users.email, email)).limit(1);
    if (!user?.passwordHash || !(await Bun.password.verify(password, user.passwordHash))) return null;
    return createSession({ id: user.id, email: user.email });
  },
  async signOut(token) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, hashSessionToken(token)));
  },
  async userIdForSession(token) {
    const [session] = await db.select({ userId: sessions.userId }).from(sessions).where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date()), isNull(sessions.revokedAt))).limit(1);
    return session?.userId ?? null;
  },
};
