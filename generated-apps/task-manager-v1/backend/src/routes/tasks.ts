import express from "express";
const router = express.Router();
import * as taskController from "../controllers/tasks";

router.get("/", taskController.getTasksController);
router.post("/", taskController.createTaskController);
router.put("/:id", taskController.updateTaskController);
router.patch("/:id", taskController.updateTaskController);
router.delete("/:id", taskController.deleteTaskController);

export default router;
