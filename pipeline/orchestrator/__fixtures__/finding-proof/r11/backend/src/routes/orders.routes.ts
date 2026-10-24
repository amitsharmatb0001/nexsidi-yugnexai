import { Router } from "express";
import { requireAuth, requireStaff } from "../middleware/auth";
import {
  createOrder,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
} from "../controllers/orders.controller";

const router = Router();

// Customer endpoints
router.post("/", requireAuth, createOrder);
router.get("/me", requireAuth, getMyOrders);

// Staff endpoints
router.get("/", requireStaff, getAllOrders);
router.patch("/:id/status", requireStaff, updateOrderStatus);
router.put("/:id/status", requireStaff, updateOrderStatus);

export default router;
