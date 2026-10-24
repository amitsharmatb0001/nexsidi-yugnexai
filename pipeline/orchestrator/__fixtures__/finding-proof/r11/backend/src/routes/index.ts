import { Router } from "express";
import authRoutes from "./auth.routes";
import menuRoutes from "./menu.routes";
import ordersRoutes from "./orders.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/menu", menuRoutes);
router.use("/orders", ordersRoutes);

export default router;
