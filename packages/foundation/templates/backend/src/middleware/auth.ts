import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config";
import { fail } from "../http/respond";

export interface SignedInUser {
  id: string;
  email: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: SignedInUser;
    }
  }
}

export function signToken(user: SignedInUser): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.jwtSecret, { expiresIn: "24h" });
}

/** Refuses a request without a valid token (401); afterwards `req.user` is the signed-in user. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return fail(res, 401, "Please sign in");
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    req.user = { id: String(payload.sub), email: String(payload.email), role: String(payload.role) };
    next();
  } catch {
    fail(res, 401, "Please sign in");
  }
}

/** Use after requireAuth: refuses anyone without one of these roles (403). */
export function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) return fail(res, 401, "Please sign in");
    if (!roles.includes(req.user.role)) return fail(res, 403, "You do not have access to this");
    next();
  };
}
