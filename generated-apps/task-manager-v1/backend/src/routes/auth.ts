import { Router } from 'express';

const router = Router();

// Auth is handled by Clerk on the frontend — no backend auth routes needed.
router.post('/register', (_req, res) => res.status(200).json({ message: "Use Clerk for authentication" }));
router.post('/login',    (_req, res) => res.status(200).json({ message: "Use Clerk for authentication" }));

export default router;
