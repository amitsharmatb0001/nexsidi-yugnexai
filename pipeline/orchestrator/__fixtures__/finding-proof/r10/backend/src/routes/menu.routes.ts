import { Router } from "express";
import { getMenu, createMenuItem, updateMenuItem } from "../controllers/menu.controller";
import { requireStaff } from "../middleware/auth";

const router = Router();

router.get("/", getMenu);
router.post("/", requireStaff, createMenuItem);
router.patch("/:id", requireStaff, updateMenuItem);
router.put("/:id", requireStaff, updateMenuItem);

export default router;
