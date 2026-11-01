import { Router } from "express";
import { signIn, signUp } from "../controllers/auth.controller";
import { authLimiter } from "../middleware/rateLimiter";

const router = Router();

router.post("/__SIGN_UP__", authLimiter, signUp);
router.post("/__SIGN_IN__", authLimiter, signIn);

export default router;
