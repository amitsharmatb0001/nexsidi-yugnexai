import rateLimit from "express-rate-limit";

const WINDOW_MS = 15 * 60 * 1000;
const message = { success: false, error: "Too many attempts, please try again later" };

/** Failed sign-ups and sign-ins: 10 per 15 minutes per address. Someone who signs in correctly is never slowed down. */
export const authLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});

/** All sign-ups and sign-ins, right or wrong: 100 per 15 minutes per address, which stops mass account creation. */
export const authVolumeLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message,
});
