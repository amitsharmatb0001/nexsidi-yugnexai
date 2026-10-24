import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      userRole?: string;
    }
  }
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "Unauthorized: Missing token" });
    return;
  }

  const token = authHeader.split(" ")[1];
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error("JWT_SECRET environment variable is missing");
    res.status(500).json({ success: false, error: "Internal server error" });
    return;
  }

  try {
    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;
    req.userId = decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    next();
  } catch (err) {
    res.status(401).json({ success: false, error: "Unauthorized: Invalid token" });
  }
};

export const requireStaff = (req: Request, res: Response, next: NextFunction): void => {
  requireAuth(req, res, () => {
    if (req.userRole !== "staff" && req.userRole !== "admin") {
      res.status(403).json({ success: false, error: "Forbidden: Staff only" });
      return;
    }
    next();
  });
};
