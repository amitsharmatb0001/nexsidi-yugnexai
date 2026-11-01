import rateLimit from "express-rate-limit";

/** For sign-up and sign-in: 10 requests per 15 minutes per address. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many attempts, please try again later" },
});
