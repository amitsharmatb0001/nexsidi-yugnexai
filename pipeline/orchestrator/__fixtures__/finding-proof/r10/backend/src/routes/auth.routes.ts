import { Router } from "express";
import rateLimit from "express-rate-limit";
import { signUp, signIn } from "../controllers/auth.controller";

const authLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    success: false,
    error: "Too many requests from this IP, please try again after a minute.",
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

const router = Router();

router.post("/sign-up", authLimiter, signUp);
router.post("/sign-in", authLimiter, signIn);

export default router;
