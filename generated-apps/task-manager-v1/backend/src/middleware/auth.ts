import { clerkMiddleware, requireAuth, getAuth } from '@clerk/express';

export const authMiddleware = [
  clerkMiddleware(),
  (req: any, res: any, next: any) => {
    if (!getAuth(req).userId) return res.status(401).json({ error: "Unauthorized" });
    next();
  }
];