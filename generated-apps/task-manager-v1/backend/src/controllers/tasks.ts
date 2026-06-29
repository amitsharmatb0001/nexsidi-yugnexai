import express from "express";
import { getAuth } from "@clerk/express";
import { Pool } from "pg";
import { CreateTaskRequest, UpdateTaskRequest } from "../types/requests";
import * as taskService from "../services/tasks";
import * as validators from "../validators/tasks";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const getTasksController = async (req: express.Request, res: express.Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { status, page, perPage } = validators.validateTaskQueryParams(req.query);

    const tasks = await taskService.getTasks(pool, userId, status, page, perPage);
    return res.json(tasks);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
};

export const createTaskController = async (req: express.Request, res: express.Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const taskData: CreateTaskRequest = req.body;
    const newTask = await taskService.createTask(pool, userId, taskData);
    return res.status(201).json(newTask);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
};

export const updateTaskController = async (req: express.Request, res: express.Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const taskId = req.params.id;
    const taskData: UpdateTaskRequest = req.body;
    await taskService.updateTask(pool, userId, taskId, taskData);
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
};

export const deleteTaskController = async (req: express.Request, res: express.Response) => {
  try {
    const { userId } = getAuth(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const taskId = req.params.id;
    await taskService.deleteTask(pool, userId, taskId);
    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  }
};
