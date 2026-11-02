import { Router } from "express";
import { signIn, signUp } from "../controllers/auth.controller";
import { authLimiter, authVolumeLimiter } from "../middleware/rateLimiter";

const router = Router();

router.post("/__SIGN_UP__", authVolumeLimiter, authLimiter, signUp);
router.post("/__SIGN_IN__", authVolumeLimiter, authLimiter, signIn);

export default router;
