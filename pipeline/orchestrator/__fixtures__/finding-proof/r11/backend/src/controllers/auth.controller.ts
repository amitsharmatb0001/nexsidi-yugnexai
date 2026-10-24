import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/pool";

const authSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(6, "Password must be at least 6 characters long"),
});

export const signUp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = authSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      res.status(400).json({ success: false, error: errorMsg });
      return;
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existingUser.rows.length > 0) {
      res.status(409).json({ success: false, error: "Email already registered" });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, $2, 'customer') RETURNING id, email, role",
      [normalizedEmail, hashedPassword]
    );

    const newUser = result.rows[0];

    const jwtSecret = process.env.JWT_SECRET!;
    const token = jwt.sign(
      { userId: newUser.id, email: newUser.email, role: newUser.role },
      jwtSecret,
      { expiresIn: "24h" }
    );

    res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: newUser.id,
          email: newUser.email,
          role: newUser.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const signIn = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = authSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      res.status(400).json({ success: false, error: errorMsg });
      return;
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    const userResult = await pool.query("SELECT id, email, password_hash, role FROM users WHERE email = $1", [normalizedEmail]);
    if (userResult.rows.length === 0) {
      res.status(401).json({ success: false, error: "Email or password is incorrect" });
      return;
    }

    const user = userResult.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      res.status(401).json({ success: false, error: "Email or password is incorrect" });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET!;
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: "24h" }
    );

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};
